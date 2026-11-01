import { routeAgentRequest } from "agents";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- build 前は存在せず、build 後は存在するため ts-expect-error は使えない
// @ts-ignore `.open-next/worker.js` は `opennextjs-cloudflare build` で生成される
import { default as openNextHandler } from "./.open-next/worker.js";

export { BingoRoom } from "./src/agents/bingo-room";
export { RoomDirectory } from "./src/agents/room-directory";

export default {
  async fetch(request, env, ctx) {
    // /agents/:agent/:name は Agent（WebSocket・callable）へ
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;
    // それ以外は Next.js（OpenNext）へ
    return openNextHandler.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Cloudflare.Env>;
