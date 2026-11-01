import { Agent, callable, getAgentByName, getCurrentAgent, type Connection, type ConnectionContext } from "agents";
import { generateHostToken, generateRoomId } from "../lib/ids";
import {
  PASSPHRASE_LOCK_MS,
  PASSPHRASE_PER_SOURCE,
  isLockedOut,
  recordLockoutFailure,
  type Lockout,
} from "../lib/rate-limit";
import { secureEqual } from "../lib/secure-compare";
import { checkRoomName, sanitizeText } from "../lib/validate";
import type { ErrorCode, Failure, Result, RoomChange, RoomEntry, RoomStatus } from "./types";

/** ルーム一覧を持つ Agent（インスタンスは1つ）。名前は固定（api.md 4-3） */
export const ROOM_DIRECTORY_NAME = "main";

type RoomRow = {
  room_id: string;
  name: string;
  status: RoomStatus;
  host_token: string;
  created_at: number;
  delete_at: number | null;
};

/** 接続ごとの状態（サーバーの中だけで使う） */
type DirectoryConnectionState = { origin: string };

const fail = (error: ErrorCode): Failure => ({ ok: false, error });

/**
 * ルーム一覧（domain-model 1章・ADR 0004）。どの callable も毎回合言葉を確かめる。
 * - 合言葉は Secret（ADMIN_PASSPHRASE）と比べる。コードやリポジトリには書かない
 * - 合言葉を間違えた回数は、接続元（IP アドレス）ごとにメモリの中だけで数える（IP は保存しない。security.md 2-2）
 * - 公開 state は使わない
 */
export class RoomDirectory extends Agent<Cloudflare.Env> {
  /** 接続 ID → 接続元。メモリの中だけ（ハイバネーションで消えたら接続 ID で数える） */
  private sources = new Map<string, string>();
  /** 接続元 → 間違えた記録 */
  private lockouts = new Map<string, Lockout>();

  /** 今の時刻（テスト用のクラスで上書きする） */
  protected now(): number {
    return Date.now();
  }

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS directory_rooms (
      room_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      host_token TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      delete_at INTEGER
    )`;
  }

  /** 公開 state は使わないので、クライアントからの書き換えも拒否する */
  validateStateChange(_next: unknown, source: Connection | "server") {
    if (source !== "server") throw new Error("FORBIDDEN");
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    // 名前は固定。ほかの名前の RoomDirectory は使わせない（api.md 7章）
    if (this.name !== ROOM_DIRECTORY_NAME) {
      connection.close(4404, "not found");
      return;
    }
    const url = new URL(ctx.request.url);
    (connection as Connection<DirectoryConnectionState>).setState({ origin: url.origin });
    const ip = ctx.request.headers.get("CF-Connecting-IP");
    if (ip) this.sources.set(connection.id, ip);
  }

  async onClose(connection: Connection) {
    this.sources.delete(connection.id);
  }

  // ───────────────────────── 管理画面から呼ぶ callable（api.md 4-3）

  @callable()
  checkPassphrase(pass: unknown): Result {
    return this.verifyPassphrase(pass) ?? { ok: true };
  }

  @callable()
  listRooms(pass: unknown): Result<{ rooms: RoomEntry[] }> {
    const denied = this.verifyPassphrase(pass);
    if (denied) return denied;
    const rows = this.sql<RoomRow>`SELECT * FROM directory_rooms ORDER BY created_at DESC`;
    return { ok: true, rooms: rows.map((r) => this.toEntry(r)) };
  }

  @callable()
  async createRoom(pass: unknown, name: unknown): Promise<Result<{ roomId: string; hostUrl: string }>> {
    const denied = this.verifyPassphrase(pass);
    if (denied) return denied;
    const checked = checkRoomName(name);
    if (!checked.ok) return fail("NAME_INVALID");
    const hostToken = generateHostToken();
    // ルーム ID が重なることはまずないが、重なったら作り直す
    for (let i = 0; i < 3; i++) {
      const roomId = generateRoomId();
      const res = await (await this.room(roomId)).initRoom(checked.value, hostToken);
      if (!res.ok && res.error === "ALREADY_INITIALIZED") continue;
      if (!res.ok) return res;
      const now = this.now();
      this.sql`INSERT INTO directory_rooms (room_id, name, status, host_token, created_at, delete_at)
        VALUES (${roomId}, ${checked.value}, 'waiting', ${hostToken}, ${now}, NULL)`;
      return { ok: true, roomId, hostUrl: this.hostUrl(roomId, hostToken) };
    }
    throw new Error("ルーム ID を作れませんでした");
  }

  @callable()
  async regenerateHostToken(pass: unknown, roomId: unknown): Promise<Result<{ hostUrl: string }>> {
    const denied = this.verifyPassphrase(pass);
    if (denied) return denied;
    const row = this.findRoom(roomId);
    if (!row) return fail("NOT_FOUND");
    const hostToken = generateHostToken();
    const res = await (await this.room(row.room_id)).setHostToken(hostToken);
    if (!res.ok) {
      if (res.error === "ROOM_NOT_FOUND") this.removeRow(row.room_id);
      return fail("NOT_FOUND");
    }
    this.sql`UPDATE directory_rooms SET host_token = ${hostToken} WHERE room_id = ${row.room_id}`;
    return { ok: true, hostUrl: this.hostUrl(row.room_id, hostToken) };
  }

  @callable()
  async deleteRoom(pass: unknown, roomId: unknown, confirmName: unknown): Promise<Result> {
    const denied = this.verifyPassphrase(pass);
    if (denied) return denied;
    const row = this.findRoom(roomId);
    if (!row) return fail("NOT_FOUND");
    if (typeof confirmName !== "string" || sanitizeText(confirmName) !== row.name) return fail("NAME_MISMATCH");
    const room = await this.room(row.room_id);
    try {
      const res = await room.deleteRoom();
      if (!res.ok && res.error === "ROOM_PLAYING") return res;
    } catch (e) {
      // BingoRoom は削除の最後に自分を止めるので、応答が返らないことがある。消えたかを確かめる
      if (await this.stillExists(row.room_id)) throw e;
    }
    this.removeRow(row.room_id);
    return { ok: true };
  }

  // ───────────────────────── BingoRoom から呼ばれる（Agent どうしの呼び出し。api.md 4-4）

  /** BingoRoom の状態が変わったとき（開始・終了） */
  async roomChanged(roomId: string, change: RoomChange): Promise<void> {
    this.sql`UPDATE directory_rooms SET status = ${change.status}, delete_at = ${change.deleteAt}
      WHERE room_id = ${roomId}`;
  }

  /** BingoRoom が期限で自動削除されたとき */
  async roomDeleted(roomId: string): Promise<void> {
    this.removeRow(roomId);
  }

  // ───────────────────────── 内部の処理

  /**
   * 合言葉を確かめる。正しければ null。
   * 同じ接続元から10分間に5回間違えたら、10分間は正しい合言葉でも RATE_LIMITED にする
   */
  private verifyPassphrase(pass: unknown): Failure | null {
    if (this.name !== ROOM_DIRECTORY_NAME) return fail("NOT_FOUND");
    const key = this.sourceKey();
    const now = this.now();
    if (isLockedOut(this.lockouts.get(key), now)) return fail("RATE_LIMITED");
    const secret = this.env.ADMIN_PASSPHRASE;
    if (!secret) {
      console.error("ADMIN_PASSPHRASE が設定されていません（wrangler secret put ADMIN_PASSPHRASE）");
    }
    if (typeof pass === "string" && secret && secureEqual(pass, secret)) {
      this.lockouts.delete(key);
      return null;
    }
    this.lockouts.set(key, recordLockoutFailure(this.lockouts.get(key), now, PASSPHRASE_PER_SOURCE, PASSPHRASE_LOCK_MS));
    return fail("BAD_PASSPHRASE");
  }

  /** 接続元を見分ける値（IP が分からないときは接続 ID） */
  private sourceKey(): string {
    const c = getCurrentAgent().connection;
    if (!c) return "rpc";
    return this.sources.get(c.id) ?? `conn:${c.id}`;
  }

  private hostUrl(roomId: string, hostToken: string): string {
    const origin = (getCurrentAgent().connection as Connection<DirectoryConnectionState> | undefined)?.state?.origin ?? "";
    return `${origin}/host/${roomId}?t=${encodeURIComponent(hostToken)}`;
  }

  private toEntry(r: RoomRow): RoomEntry {
    return {
      roomId: r.room_id,
      name: r.name,
      status: r.status,
      createdAt: r.created_at,
      deleteAt: r.delete_at,
      hostUrl: this.hostUrl(r.room_id, r.host_token),
    };
  }

  private findRoom(roomId: unknown): RoomRow | undefined {
    if (typeof roomId !== "string") return undefined;
    return this.sql<RoomRow>`SELECT * FROM directory_rooms WHERE room_id = ${roomId}`[0];
  }

  private removeRow(roomId: string) {
    this.sql`DELETE FROM directory_rooms WHERE room_id = ${roomId}`;
  }

  /** BingoRoom がまだあるか。止まっている途中は呼び出しが失敗するので、少し待ってやり直す */
  private async stillExists(roomId: string): Promise<boolean> {
    for (let i = 0; i < 5; i++) {
      try {
        return await (await this.room(roomId)).exists();
      } catch {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    return true;
  }

  private room(roomId: string) {
    return getAgentByName(this.env.BingoRoom, roomId);
  }
}
