// テスト用のエントリ：OpenNext の生成物に依存せず、Agent だけを動かす。
// 本番に入れてはいけない確認用の callable（役割を自由に書き換えるなど）は、
// ここで本番のクラスを継承して足す。クラス名は wrangler.jsonc の class_name と同じにする。
import { callable, getAgentByName, getCurrentAgent, routeAgentRequest, type Connection } from "agents";
import { BingoRoom as ProdBingoRoom } from "../src/agents/bingo-room";
import { RoomDirectory as ProdRoomDirectory } from "../src/agents/room-directory";
import type { ConnectionState, RoomChange } from "../src/agents/types";
import type { Card } from "../src/lib/bingo";

export class BingoRoom extends ProdBingoRoom {
  // メモリの中だけに持つ（Durable Object が追い出されると元に戻る）
  private clockOffset = 0;
  private nextNumbers: number[] = [];
  private nextCards: Card[] = [];

  protected now() {
    return Date.now() + this.clockOffset;
  }

  protected pickNumber(drawn: readonly number[]) {
    return this.nextNumbers.shift() ?? super.pickNumber(drawn);
  }

  protected makeCard(drawn: readonly number[]) {
    return this.nextCards.shift() ?? super.makeCard(drawn);
  }

  /** 時計を進める（抽選の間隔・試行回数の制限・自動削除の確認用） */
  async testAdvance(ms: number) {
    this.clockOffset += ms;
  }

  /** 次に引く番号を決める */
  async testSetNextNumbers(numbers: number[]) {
    this.nextNumbers = [...numbers];
  }

  /** 次に作るカードを決める */
  async testSetNextCards(cards: Card[]) {
    this.nextCards = cards.map((c) => c.map((row) => [...row]));
  }

  /** 予約されているスケジュール */
  async testSchedules() {
    return (await this.listSchedules()).map((s) => ({ callback: s.callback, time: s.time }));
  }

  /** 呼んだ接続を取り出し、役割の読み書きができることを確かめる */
  @callable()
  whoami(setRole?: ConnectionState["role"]) {
    const { connection } = getCurrentAgent();
    if (!connection) throw new Error("NO_CONNECTION");
    const conn = connection as Connection<ConnectionState>;
    if (setRole) conn.setState({ role: setRole });
    return { ok: true, connectionId: conn.id, role: conn.state?.role ?? "guest" };
  }

  /** Agent どうしの呼び出し（DO RPC）で呼ばれる */
  async rpcPing(from: string) {
    return { ok: true, room: this.name, from };
  }
}

export class RoomDirectory extends ProdRoomDirectory {
  /** BingoRoom から届いた知らせ（テストで確かめる） */
  private received: { roomId: string; change: RoomChange | "deleted" }[] = [];

  async roomChanged(roomId: string, change: RoomChange) {
    this.received.push({ roomId, change });
  }

  async roomDeleted(roomId: string) {
    this.received.push({ roomId, change: "deleted" });
  }

  async testReceived(roomId: string) {
    return this.received.filter((r) => r.roomId === roomId).map((r) => r.change);
  }

  /** Agent どうしの呼び出しの確認：指定した BingoRoom を DO RPC で呼ぶ */
  @callable()
  async pingRoom(roomId: string) {
    const room = await getAgentByName(
      this.env.BingoRoom as unknown as DurableObjectNamespace<BingoRoom>,
      roomId,
    );
    return room.rpcPing(this.name);
  }
}

export default {
  async fetch(request, env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
