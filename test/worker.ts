// テスト用のエントリ：OpenNext の生成物に依存せず、Agent だけを動かす。
// 本番に入れてはいけない確認用の callable（役割を自由に書き換えるなど）は、
// ここで本番のクラスを継承して足す。クラス名は wrangler.jsonc の class_name と同じにする。
import { callable, getAgentByName, getCurrentAgent, routeAgentRequest, type Connection } from "agents";
import { BingoRoom as ProdBingoRoom } from "../src/agents/bingo-room";
import { RoomDirectory as ProdRoomDirectory } from "../src/agents/room-directory";
import type { ConnectionState } from "../src/agents/types";

export class BingoRoom extends ProdBingoRoom {
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
