import { Agent, callable, getAgentByName } from "agents";

/** ルーム一覧を持つ Agent（インスタンスは1つ）。名前は固定 */
export const ROOM_DIRECTORY_NAME = "main";

/**
 * Phase 2 では疎通確認用の最小構成。合言葉の確認や一覧は Phase 5 で実装する。
 */
export class RoomDirectory extends Agent<Cloudflare.Env> {
  @callable()
  ping(): { ok: true; now: number } {
    return { ok: true, now: Date.now() };
  }

  /** Agent どうしの呼び出しの確認：指定した BingoRoom を DO RPC で呼ぶ */
  @callable()
  async pingRoom(roomId: string): Promise<{ ok: true; room: string; from: string }> {
    const room = await getAgentByName(this.env.BingoRoom, roomId);
    return room.rpcPing(this.name);
  }
}
