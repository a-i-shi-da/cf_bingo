import { Agent, callable, getAgentByName, getCurrentAgent, type Connection } from "agents";
import {
  MAX_NUMBER,
  drawNumber,
  evaluateCard,
  generateCard,
  generateLateJoinCard,
  isLateJoinClosed,
  judgeAll,
  type Card,
} from "../lib/bingo";
import { generateParticipantId } from "../lib/ids";
import { generateJoinCode, normalizeJoinCode } from "../lib/join-code";
import {
  HOST_PER_CONNECTION,
  JOIN_PER_CONNECTION,
  JOIN_PER_ROOM,
  isRateLimited,
  recordFailure,
  recentFailures,
} from "../lib/rate-limit";
import { buildResultsCsv } from "../lib/results";
import { secureEqual } from "../lib/secure-compare";
import { checkNickname, checkRoomName, nicknameKey } from "../lib/validate";
import { ROOM_DIRECTORY_NAME } from "./room-directory";
import type {
  CodeCounts,
  CodeEntry,
  CodeStatus,
  ConnectionState,
  ErrorCode,
  Failure,
  HostParticipant,
  PlayerSelf,
  Result,
  RoomPublicState,
  ServerMessage,
  Winner,
} from "./types";

/** 参加者の上限（domain-model 8章） */
export const MAX_PARTICIPANTS = 100;
/** 1ルームで発行できる参加コードの上限 */
export const MAX_CODES = 150;
/** 抽選のあと、次の抽選を受け付けない時間（game-rules 2章） */
export const DRAW_COOLDOWN_MS = 3000;
/** 終了から削除まで（domain-model 7章） */
export const FINISHED_TTL_MS = 7 * 24 * 3600_000;
/** 最後に使われてから削除まで */
export const IDLE_TTL_MS = 30 * 24 * 3600_000;
/** host:participants をまとめる間隔（api.md 3章：多くても1秒に1回） */
const HOST_LIST_INTERVAL_MS = 1000;

type RoomRow = {
  host_token: string;
  host_token_version: number;
  created_at: number;
  last_active_at: number;
  winner_count: number;
};

type ParticipantRow = {
  id: string;
  nickname: string;
  card: string;
  joined_at: number;
  joined_at_seq: number;
  last_seen_at: number;
  reach_lines: number;
  completed_lines: number;
  bingo_at_seq: number | null;
  bingo_rank: number | null;
};

type CodeRow = { code: string; status: CodeStatus; participant_id: string | null; issued_at: number };

const fail = (error: ErrorCode): Failure => ({ ok: false, error });

/**
 * 1ルーム = 1インスタンス（名前 = roomId）。
 * - 公開 state（RoomPublicState）は全接続に配る。秘密の値・カードは SQL に置く
 * - 接続の役割は connection.setState に記録する（api.md 1章）
 * - RoomDirectory が initRoom で初期化するまでは、接続も callable も受け付けない
 */
export class BingoRoom extends Agent<Cloudflare.Env, RoomPublicState> {
  initialState: RoomPublicState = {
    roomId: "",
    name: "",
    status: "waiting",
    drawn: [],
    lastDrawnAt: null,
    participantCount: 0,
    reachCount: 0,
    winners: [],
    startedAt: null,
    finishedAt: null,
    deleteAt: null,
  };

  private hostListTimer: ReturnType<typeof setTimeout> | null = null;
  private hostListSentAt = 0;

  // ───────────────────────── 差し替えられる部分（テスト用のクラスで上書きする）

  /** 今の時刻 */
  protected now(): number {
    return Date.now();
  }

  /** 次の番号を選ぶ */
  protected pickNumber(drawn: readonly number[]): number | null {
    return drawNumber(drawn);
  }

  /** 参加者のカードを作る。途中参加でビンゴにならないカードを作れないときは null */
  protected makeCard(drawn: readonly number[]): Card | null {
    return drawn.length === 0 ? generateCard() : generateLateJoinCard(drawn);
  }

  // ───────────────────────── 起動と接続

  async onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS bingo_room (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      host_token TEXT NOT NULL,
      host_token_version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_active_at INTEGER NOT NULL,
      winner_count INTEGER NOT NULL DEFAULT 0
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS bingo_participants (
      id TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      nickname_key TEXT NOT NULL,
      card TEXT NOT NULL,
      joined_at INTEGER NOT NULL,
      joined_at_seq INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      reach_lines INTEGER NOT NULL DEFAULT 0,
      completed_lines INTEGER NOT NULL DEFAULT 0,
      bingo_at_seq INTEGER,
      bingo_rank INTEGER,
      removed INTEGER NOT NULL DEFAULT 0
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS bingo_codes (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      participant_id TEXT,
      issued_at INTEGER NOT NULL,
      ord INTEGER NOT NULL
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS bingo_join_failures (at INTEGER NOT NULL)`;
  }

  /** 公開 state はサーバーだけが変えられる（クライアントからの setState を拒否する） */
  validateStateChange(_next: RoomPublicState, source: Connection | "server") {
    if (source !== "server") {
      throw new Error("FORBIDDEN");
    }
  }

  async onConnect(connection: Connection) {
    if (!this.room()) {
      // RoomDirectory が作っていないルーム（または削除済み）
      this.sendTo(connection, { type: "room:not-found" });
      connection.close(4404, "room not found");
      return;
    }
    this.touch();
  }

  async onClose(connection: Connection) {
    const st = (connection as Connection<ConnectionState>).state;
    if (st?.role === "player" && st.participantId && this.room()) {
      this.sql`UPDATE bingo_participants SET last_seen_at = ${this.now()} WHERE id = ${st.participantId}`;
      this.queueHostParticipants();
    }
  }

  // ───────────────────────── Agent どうしの呼び出し（RoomDirectory から。@callable ではない）

  /** ルームを初期化する（createRoom から呼ばれる。api.md 4-3） */
  async initRoom(name: string, hostToken: string): Promise<Result> {
    if (this.room()) return fail("ALREADY_INITIALIZED");
    const checked = checkRoomName(name);
    if (!checked.ok) return fail("NAME_INVALID");
    if (typeof hostToken !== "string" || hostToken.length < 32) return fail("INVALID_ARGUMENT");
    const now = this.now();
    this.sql`INSERT INTO bingo_room (id, host_token, host_token_version, created_at, last_active_at, winner_count)
      VALUES (1, ${hostToken}, 1, ${now}, ${now}, 0)`;
    this.setState({ ...this.initialState, roomId: this.name, name: checked.value });
    await this.schedule(new Date(now + IDLE_TTL_MS), "checkExpiry");
    return { ok: true };
  }

  /** 司会トークンを作り直す（regenerateHostToken から呼ばれる）。古いトークンの司会接続は切る */
  async setHostToken(hostToken: string): Promise<Result> {
    const room = this.room();
    if (!room) return fail("ROOM_NOT_FOUND");
    if (typeof hostToken !== "string" || hostToken.length < 32) return fail("INVALID_ARGUMENT");
    const version = room.host_token_version + 1;
    this.sql`UPDATE bingo_room SET host_token = ${hostToken}, host_token_version = ${version}`;
    for (const c of this.connections()) {
      if (c.state?.role === "host") {
        this.sendTo(c, { type: "host:token-changed" });
        c.close(4001, "host token changed");
      }
    }
    return { ok: true };
  }

  /** 手で削除する（deleteRoom から呼ばれる）。ゲーム中は削除できない（F-19） */
  async deleteRoom(): Promise<Result> {
    if (!this.room()) return fail("ROOM_NOT_FOUND");
    if (this.state.status === "playing") return fail("ROOM_PLAYING");
    await this.deleteAllData();
    return { ok: true };
  }

  /** 削除の期限を確かめる（スケジュールから呼ばれる。domain-model 7章） */
  async checkExpiry() {
    const room = this.room();
    if (!room) return;
    const expiry =
      this.state.status === "finished" && this.state.deleteAt !== null
        ? this.state.deleteAt
        : room.last_active_at + IDLE_TTL_MS;
    if (this.now() >= expiry) {
      await this.notifyDirectory("deleted");
      await this.deleteAllData();
    } else {
      await this.schedule(new Date(expiry), "checkExpiry");
    }
  }

  // ───────────────────────── だれでも呼べる callable（api.md 4-1）

  /** 疎通確認用（秘密の値を返さない） */
  @callable()
  ping(): { ok: true; name: string; now: number } {
    return { ok: true, name: this.name, now: Date.now() };
  }

  @callable()
  authScreen(): Result {
    const c = this.currentConnection();
    if (!c) return fail("FORBIDDEN");
    if (!this.room()) return fail("ROOM_NOT_FOUND");
    this.setRole(c, { role: "screen" });
    return { ok: true };
  }

  @callable()
  authHost(token: unknown): Result {
    const c = this.currentConnection();
    if (!c) return fail("FORBIDDEN");
    const room = this.room();
    if (!room) return fail("ROOM_NOT_FOUND");
    const now = this.now();
    if (isRateLimited(c.state?.hostFailures ?? [], now, HOST_PER_CONNECTION)) {
      // 戻り値を送ってから切る
      setTimeout(() => c.close(4029, "rate limited"), 0);
      return fail("RATE_LIMITED");
    }
    if (typeof token !== "string" || !secureEqual(token, room.host_token)) {
      c.setState({ ...this.connState(c), hostFailures: recordFailure(c.state?.hostFailures ?? [], now, HOST_PER_CONNECTION) });
      return fail("BAD_TOKEN");
    }
    this.setRole(c, { role: "host", hostTokenVersion: room.host_token_version });
    this.touch();
    this.sendTo(c, { type: "host:participants", participants: this.hostParticipants() });
    this.sendTo(c, { type: "host:codes", ...this.codeCounts() });
    return { ok: true };
  }

  @callable()
  join(code: unknown, nickname: unknown): Result<{ self: PlayerSelf }> {
    const c = this.currentConnection();
    if (!c) return fail("FORBIDDEN");
    if (!this.room()) return fail("ROOM_NOT_FOUND");
    const found = this.findCodeForAuth(c, code);
    if (!found.ok) return found;
    if (found.row.status === "used") return this.attachPlayer(c, found.row);

    // 未使用のコード → 新しく参加する
    const st = this.state;
    if (st.status === "finished") return fail("ROOM_FINISHED");
    const nick = checkNickname(nickname);
    if (!nick.ok) return fail("NICKNAME_INVALID");
    if (this.activeParticipantCount() >= MAX_PARTICIPANTS) return fail("ROOM_FULL");
    if (st.status === "playing" && isLateJoinClosed(st.drawn)) return fail("LATE_JOIN_CLOSED");
    const key = nicknameKey(nick.value);
    const taken = this.sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM bingo_participants WHERE nickname_key = ${key} AND removed = 0`;
    if (taken[0].n > 0) return fail("NICKNAME_TAKEN");

    const card = this.makeCard(st.drawn);
    if (!card) return fail("LATE_JOIN_CLOSED");
    const { almostLines } = evaluateCard(card, st.drawn);
    const id = generateParticipantId();
    const now = this.now();
    this.sql`INSERT INTO bingo_participants
      (id, nickname, nickname_key, card, joined_at, joined_at_seq, last_seen_at, reach_lines)
      VALUES (${id}, ${nick.value}, ${key}, ${JSON.stringify(card)}, ${now}, ${st.drawn.length}, ${now}, ${almostLines})`;
    this.sql`UPDATE bingo_codes SET status = 'used', participant_id = ${id} WHERE code = ${found.row.code}`;
    this.refreshPublicState();
    this.broadcastHostCodes();
    return this.attachPlayer(c, { ...found.row, status: "used", participant_id: id });
  }

  @callable()
  resume(code: unknown): Result<{ self: PlayerSelf }> {
    const c = this.currentConnection();
    if (!c) return fail("FORBIDDEN");
    if (!this.room()) return fail("ROOM_NOT_FOUND");
    const found = this.findCodeForAuth(c, code);
    if (!found.ok) return found;
    if (found.row.status === "unused") return fail("CODE_UNUSED");
    return this.attachPlayer(c, found.row);
  }

  // ───────────────────────── 司会だけの callable（api.md 4-2）

  @callable()
  start(): Result {
    const denied = this.requireHost();
    if (denied) return denied;
    if (this.state.status !== "waiting") return fail("NOT_WAITING");
    this.setState({ ...this.state, status: "playing", startedAt: this.now() });
    void this.notifyDirectory("changed");
    return { ok: true };
  }

  @callable()
  draw(): Result<{ seq: number; number: number }> {
    const denied = this.requireHost();
    if (denied) return denied;
    const st = this.state;
    if (st.status !== "playing") return fail("NOT_PLAYING");
    if (st.drawn.length >= MAX_NUMBER) return fail("NO_NUMBERS_LEFT");
    const now = this.now();
    if (st.lastDrawnAt !== null && now - st.lastDrawnAt < DRAW_COOLDOWN_MS) return fail("COOLDOWN");
    const number = this.pickNumber(st.drawn);
    if (number === null) return fail("NO_NUMBERS_LEFT");
    const drawn = [...st.drawn, number];

    // 全員（接続していない人も含む）を判定する（game-rules 6章）
    const rows = this.activeParticipants();
    const room = this.room()!;
    const { results, winnerCount } = judgeAll(
      rows.map((r) => ({ id: r.id, card: JSON.parse(r.card) as Card, bingoAtSeq: r.bingo_at_seq, bingoRank: r.bingo_rank })),
      drawn,
      room.winner_count,
    );
    const changed: string[] = [];
    results.forEach((res, i) => {
      const before = rows[i];
      if (
        before.reach_lines === res.reachLines &&
        before.completed_lines === res.completedLines &&
        before.bingo_at_seq === res.bingoAtSeq
      ) {
        return;
      }
      this.sql`UPDATE bingo_participants SET reach_lines = ${res.reachLines}, completed_lines = ${res.completedLines},
        bingo_at_seq = ${res.bingoAtSeq}, bingo_rank = ${res.bingoRank} WHERE id = ${res.id}`;
      changed.push(res.id);
    });
    this.sql`UPDATE bingo_room SET winner_count = ${winnerCount}, last_active_at = ${now}`;
    this.refreshPublicState({ drawn, lastDrawnAt: now });

    for (const id of changed) this.sendPlayerSelf(id, false);
    this.queueHostParticipants();
    return { ok: true, seq: drawn.length, number };
  }

  @callable()
  async finish(): Promise<Result> {
    const denied = this.requireHost();
    if (denied) return denied;
    if (this.state.status !== "playing") return fail("NOT_PLAYING");
    const now = this.now();
    const deleteAt = now + FINISHED_TTL_MS;
    this.setState({ ...this.state, status: "finished", finishedAt: now, deleteAt });
    await this.schedule(new Date(deleteAt), "checkExpiry");
    void this.notifyDirectory("changed");
    return { ok: true };
  }

  @callable()
  issueCodes(count: unknown): Result<{ codes: string[] }> {
    const denied = this.requireHost() ?? this.rejectIfFinished();
    if (denied) return denied;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1) return fail("INVALID_ARGUMENT");
    const existing = this.allCodes();
    if (existing.size + count > MAX_CODES) return fail("CODE_LIMIT");
    const now = this.now();
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const code = generateJoinCode(existing);
      existing.add(code);
      codes.push(code);
      this.insertCode(code, "unused", null, now);
    }
    this.broadcastHostCodes();
    return { ok: true, codes };
  }

  @callable()
  listCodes(filter: unknown): Result<{ codes: CodeEntry[] }> {
    const denied = this.requireHost();
    if (denied) return denied;
    if (filter !== "unused" && filter !== "all") return fail("INVALID_ARGUMENT");
    const rows =
      filter === "unused"
        ? this.sql<CodeRow>`SELECT * FROM bingo_codes WHERE status = 'unused' ORDER BY ord`
        : this.sql<CodeRow>`SELECT * FROM bingo_codes WHERE status != 'revoked' ORDER BY ord`;
    return { ok: true, codes: rows.map((r) => ({ code: r.code, status: r.status, issuedAt: r.issued_at })) };
  }

  @callable()
  getParticipantCode(participantId: unknown): Result<{ code: string }> {
    const denied = this.requireHost();
    if (denied) return denied;
    const p = this.findActiveParticipant(participantId);
    if (!p) return fail("NOT_FOUND");
    const code = this.sql<{ code: string }>`
      SELECT code FROM bingo_codes WHERE participant_id = ${p.id} AND status = 'used'`[0];
    if (!code) return fail("NOT_FOUND");
    return { ok: true, code: code.code };
  }

  @callable()
  removeParticipant(participantId: unknown): Result {
    const denied = this.requireHost() ?? this.rejectIfFinished();
    if (denied) return denied;
    const p = this.findActiveParticipant(participantId);
    if (!p) return fail("NOT_FOUND");
    // 記録は消すが、winner_count は戻さない（順位は付け直さない。game-rules 8章）
    this.sql`UPDATE bingo_participants SET removed = 1, reach_lines = 0, completed_lines = 0,
      bingo_at_seq = NULL, bingo_rank = NULL WHERE id = ${p.id}`;
    this.sql`UPDATE bingo_codes SET status = 'revoked' WHERE participant_id = ${p.id}`;
    for (const c of this.connections()) {
      if (c.state?.role === "player" && c.state.participantId === p.id) {
        this.sendTo(c, { type: "player:removed" });
        c.close(4003, "removed");
      }
    }
    this.refreshPublicState();
    this.broadcastHostCodes();
    this.queueHostParticipants();
    return { ok: true };
  }

  @callable()
  replaceParticipantCode(participantId: unknown): Result<{ code: string }> {
    const denied = this.requireHost() ?? this.rejectIfFinished();
    if (denied) return denied;
    const p = this.findActiveParticipant(participantId);
    if (!p) return fail("NOT_FOUND");
    const existing = this.allCodes();
    if (existing.size + 1 > MAX_CODES) return fail("CODE_LIMIT");
    const code = generateJoinCode(existing);
    this.sql`UPDATE bingo_codes SET status = 'revoked' WHERE participant_id = ${p.id} AND status = 'used'`;
    this.insertCode(code, "used", p.id, this.now());
    for (const c of this.connections()) {
      if (c.state?.role === "player" && c.state.participantId === p.id && c.state.code !== code) {
        this.sendTo(c, { type: "player:code-replaced" });
        c.close(4003, "code replaced");
      }
    }
    this.broadcastHostCodes();
    this.queueHostParticipants();
    return { ok: true, code };
  }

  @callable()
  revokeCode(code: unknown): Result {
    const denied = this.requireHost() ?? this.rejectIfFinished();
    if (denied) return denied;
    const normalized = typeof code === "string" ? normalizeJoinCode(code) : null;
    const row = normalized ? this.sql<CodeRow>`SELECT * FROM bingo_codes WHERE code = ${normalized}`[0] : undefined;
    if (!row) return fail("NOT_FOUND");
    if (row.status === "used") return fail("CODE_USED");
    if (row.status === "unused") {
      this.sql`UPDATE bingo_codes SET status = 'revoked' WHERE code = ${row.code}`;
      this.broadcastHostCodes();
    }
    return { ok: true };
  }

  @callable()
  exportResults(): Result<{ csv: string }> {
    const denied = this.requireHost();
    if (denied) return denied;
    const csv = buildResultsCsv(
      this.activeParticipants().map((r) => ({
        nickname: r.nickname,
        joinedAt: r.joined_at,
        joinedAtSeq: r.joined_at_seq,
        reachLines: r.reach_lines,
        completedLines: r.completed_lines,
        bingoAtSeq: r.bingo_at_seq,
        bingoRank: r.bingo_rank,
      })),
    );
    return { ok: true, csv };
  }

  // ───────────────────────── 内部の処理

  private room(): RoomRow | undefined {
    return this.sql<RoomRow>`SELECT * FROM bingo_room WHERE id = 1`[0];
  }

  private currentConnection(): Connection<ConnectionState> | undefined {
    return getCurrentAgent().connection as Connection<ConnectionState> | undefined;
  }

  private connections(): Connection<ConnectionState>[] {
    return [...this.getConnections<ConnectionState>()];
  }

  private connState(c: Connection<ConnectionState>): ConnectionState {
    return (c.state as ConnectionState | null) ?? { role: "guest" };
  }

  /** 役割を記録する（1つの接続が持てる役割は1つ。試行回数の記録は残す） */
  private setRole(c: Connection<ConnectionState>, next: ConnectionState) {
    const prev = this.connState(c);
    c.setState({ ...next, joinFailures: prev.joinFailures, hostFailures: prev.hostFailures });
  }

  private sendTo(c: Connection, message: ServerMessage) {
    c.send(JSON.stringify(message));
  }

  /** 司会の接続からの要求か（作り直す前のトークンで名乗った接続は認めない）。認めたら、最後に使われた日時を更新する */
  private requireHost(): Failure | null {
    const room = this.room();
    if (!room) return fail("ROOM_NOT_FOUND");
    const st = this.currentConnection()?.state;
    if (st?.role !== "host" || st.hostTokenVersion !== room.host_token_version) return fail("FORBIDDEN");
    // 司会の操作は「使われた」に数える（domain-model 7章）
    this.touch();
    return null;
  }

  private rejectIfFinished(): Failure | null {
    return this.state.status === "finished" ? fail("ROOM_FINISHED") : null;
  }

  /** 最後に使われた時刻を更新する（放置ルームの削除に使う。終了後は7日で消えるので更新しない） */
  private touch() {
    if (this.state.status === "finished") return;
    this.sql`UPDATE bingo_room SET last_active_at = ${this.now()}`;
  }

  /**
   * join・resume で入力された参加コードを調べる。試行回数の制限もここで行う。
   * 存在しないコード・無効のコードは「間違い」として数える
   */
  private findCodeForAuth(
    c: Connection<ConnectionState>,
    code: unknown,
  ): { ok: true; row: CodeRow } | Failure {
    const now = this.now();
    const connFailures = c.state?.joinFailures ?? [];
    const roomFailures = this.sql<{ at: number }>`SELECT at FROM bingo_join_failures`.map((r) => r.at);
    if (isRateLimited(connFailures, now, JOIN_PER_CONNECTION) || isRateLimited(roomFailures, now, JOIN_PER_ROOM)) {
      return fail("RATE_LIMITED");
    }
    const normalized = typeof code === "string" ? normalizeJoinCode(code) : null;
    const row = normalized ? this.sql<CodeRow>`SELECT * FROM bingo_codes WHERE code = ${normalized}`[0] : undefined;
    if (row && row.status !== "revoked") return { ok: true, row };

    c.setState({ ...this.connState(c), joinFailures: recordFailure(connFailures, now, JOIN_PER_CONNECTION) });
    const cutoff = now - JOIN_PER_ROOM.windowMs;
    this.sql`DELETE FROM bingo_join_failures WHERE at <= ${cutoff}`;
    if (recentFailures(roomFailures, now, JOIN_PER_ROOM).length < JOIN_PER_ROOM.max) {
      this.sql`INSERT INTO bingo_join_failures (at) VALUES (${now})`;
    }
    return fail(row ? "CODE_REVOKED" : "CODE_INVALID");
  }

  /** 使用済みのコードの参加者として、接続に役割を記録する（参加・復帰の共通部分） */
  private attachPlayer(c: Connection<ConnectionState>, row: CodeRow): Result<{ self: PlayerSelf }> {
    const p = row.participant_id ? this.findActiveParticipant(row.participant_id) : undefined;
    if (!p) return fail("CODE_REVOKED");
    this.setRole(c, { role: "player", participantId: p.id, code: row.code });
    this.sql`UPDATE bingo_participants SET last_seen_at = ${this.now()} WHERE id = ${p.id}`;
    this.touch();
    const self = this.playerSelf(p, true);
    this.sendTo(c, { type: "player:self", ...self });
    this.queueHostParticipants();
    return { ok: true, self };
  }

  private playerSelf(p: ParticipantRow, withCard: boolean): PlayerSelf {
    return {
      nickname: p.nickname,
      ...(withCard ? { card: JSON.parse(p.card) as Card } : {}),
      reachLines: p.reach_lines,
      completedLines: p.completed_lines,
      bingoRank: p.bingo_rank,
      bingoAtSeq: p.bingo_at_seq,
    };
  }

  /** その参加者の接続すべてに player:self を送る（2台でつないでいれば両方に） */
  private sendPlayerSelf(participantId: string, withCard: boolean) {
    const p = this.findActiveParticipant(participantId);
    if (!p) return;
    const message: ServerMessage = { type: "player:self", ...this.playerSelf(p, withCard) };
    for (const c of this.connections()) {
      if (c.state?.role === "player" && c.state.participantId === participantId) this.sendTo(c, message);
    }
  }

  private activeParticipants(): ParticipantRow[] {
    return this.sql<ParticipantRow>`SELECT * FROM bingo_participants WHERE removed = 0 ORDER BY joined_at`;
  }

  private activeParticipantCount(): number {
    return this.sql<{ n: number }>`SELECT COUNT(*) AS n FROM bingo_participants WHERE removed = 0`[0].n;
  }

  private findActiveParticipant(id: unknown): ParticipantRow | undefined {
    if (typeof id !== "string") return undefined;
    return this.sql<ParticipantRow>`SELECT * FROM bingo_participants WHERE id = ${id} AND removed = 0`[0];
  }

  private allCodes(): Set<string> {
    // 無効のコードも含める（同じコードを二度発行しない）
    return new Set(this.sql<{ code: string }>`SELECT code FROM bingo_codes`.map((r) => r.code));
  }

  private insertCode(code: string, status: CodeStatus, participantId: string | null, now: number) {
    const ord = this.sql<{ n: number }>`SELECT COALESCE(MAX(ord), 0) + 1 AS n FROM bingo_codes`[0].n;
    this.sql`INSERT INTO bingo_codes (code, status, participant_id, issued_at, ord)
      VALUES (${code}, ${status}, ${participantId}, ${now}, ${ord})`;
  }

  /** 人数・リーチ・ビンゴした人を SQL から数え直して、公開 state を配る */
  private refreshPublicState(patch: Partial<RoomPublicState> = {}) {
    const rows = this.activeParticipants();
    const winners: Winner[] = rows
      .filter((r) => r.bingo_rank !== null && r.bingo_at_seq !== null)
      .map((r) => ({ nickname: r.nickname, rank: r.bingo_rank!, atSeq: r.bingo_at_seq! }))
      .sort((a, b) => a.rank - b.rank || a.nickname.localeCompare(b.nickname, "ja"));
    this.setState({
      ...this.state,
      ...patch,
      participantCount: rows.length,
      reachCount: rows.filter((r) => r.bingo_at_seq === null && r.reach_lines > 0).length,
      winners,
    });
  }

  private codeCounts(): CodeCounts {
    const rows = this.sql<{ status: CodeStatus; n: number }>`
      SELECT status, COUNT(*) AS n FROM bingo_codes GROUP BY status`;
    const get = (s: CodeStatus) => rows.find((r) => r.status === s)?.n ?? 0;
    const used = get("used");
    const unused = get("unused");
    const revoked = get("revoked");
    return { issued: used + unused + revoked, used, unused, revoked };
  }

  private hostConnections(): Connection<ConnectionState>[] {
    const version = this.room()?.host_token_version;
    return this.connections().filter((c) => c.state?.role === "host" && c.state.hostTokenVersion === version);
  }

  private broadcastHostCodes() {
    const message: ServerMessage = { type: "host:codes", ...this.codeCounts() };
    for (const c of this.hostConnections()) this.sendTo(c, message);
  }

  private hostParticipants(): HostParticipant[] {
    const online = new Set<string>();
    for (const c of this.connections()) {
      // 開いている接続だけを数える（onClose の時点で閉じた接続は一覧にないことをテストで確認済み。念のため）
      if (c.readyState !== WebSocket.OPEN) continue;
      if (c.state?.role === "player" && c.state.participantId) online.add(c.state.participantId);
    }
    return this.activeParticipants().map((r) => ({
      id: r.id,
      nickname: r.nickname,
      online: online.has(r.id),
      lastSeenAt: r.last_seen_at,
      joinedAt: r.joined_at,
      joinedAtSeq: r.joined_at_seq,
      reachLines: r.reach_lines,
      bingoRank: r.bingo_rank,
      bingoAtSeq: r.bingo_at_seq,
    }));
  }

  /** host:participants を送る。前に送ってから1秒たっていなければ、まとめて後で送る */
  private queueHostParticipants() {
    if (this.hostListTimer) return;
    const wait = this.hostListSentAt + HOST_LIST_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.sendHostParticipants();
      return;
    }
    this.hostListTimer = setTimeout(() => {
      this.hostListTimer = null;
      this.sendHostParticipants();
    }, wait);
  }

  private sendHostParticipants() {
    if (!this.room()) return;
    this.hostListSentAt = Date.now();
    const hosts = this.hostConnections();
    if (hosts.length === 0) return;
    const message: ServerMessage = { type: "host:participants", participants: this.hostParticipants() };
    for (const c of hosts) this.sendTo(c, message);
  }

  /** RoomDirectory に状態の変化・削除を知らせる。失敗してもゲームは止めない */
  private async notifyDirectory(kind: "changed" | "deleted") {
    try {
      const dir = await getAgentByName(this.env.RoomDirectory, ROOM_DIRECTORY_NAME);
      if (kind === "deleted") await dir.roomDeleted(this.name);
      else await dir.roomChanged(this.name, { status: this.state.status, deleteAt: this.state.deleteAt });
    } catch (e) {
      console.error("RoomDirectory への通知に失敗しました", e);
    }
  }

  /** 全員に room:deleted を送って接続を切り、データをすべて消す */
  private async deleteAllData() {
    if (this.hostListTimer) clearTimeout(this.hostListTimer);
    this.hostListTimer = null;
    for (const c of this.connections()) {
      this.sendTo(c, { type: "room:deleted" });
      c.close(4410, "room deleted");
    }
    await this.destroy();
  }
}
