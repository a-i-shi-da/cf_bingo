// テスト用のエントリ：OpenNext の生成物に依存せず、Agent だけを動かす
import { routeAgentRequest } from "agents";

export { BingoRoom } from "../src/agents/bingo-room";
export { RoomDirectory } from "../src/agents/room-directory";

export default {
  async fetch(request, env) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
