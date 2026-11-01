import { env } from "cloudflare:workers";
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { getAgentByName } from "agents";
import { connectAgent } from "./helpers/agent-socket";

describe("Phase 2 疎通確認", () => {
  it("BingoRoom に WebSocket でつなぐと公開 state が届く", async () => {
    const c = await connectAgent("bingo-room", "smoke-1");
    const frame = await c.waitFor((f) => f.type === "cf_agent_state");
    expect(frame.state).toMatchObject({ status: "waiting", drawn: [] });
    c.close();
  });

  it("callable（ping）が返る", async () => {
    const c = await connectAgent("bingo-room", "smoke-2");
    expect(await c.call("ping")).toMatchObject({ ok: true, name: "smoke-2" });
    c.close();
  });

  it("callable から呼んだ接続を取り出し、役割を記録できる", async () => {
    const a = await connectAgent("bingo-room", "smoke-3");
    const b = await connectAgent("bingo-room", "smoke-3");
    await a.call("whoami", "host");
    expect(await a.call("whoami")).toMatchObject({ role: "host" });
    // 別の接続には影響しない
    expect(await b.call("whoami")).toMatchObject({ role: "guest" });
    a.close();
    b.close();
  });

  it("役割はハイバネーション（休止）から戻ったあとも残る", async () => {
    const c = await connectAgent("bingo-room", "smoke-hib");
    await c.call("whoami", "host");
    const stub = await getAgentByName(env.BingoRoom, "smoke-hib");
    // メモリから追い出す。WebSocket はつないだまま（本番のハイバネーションと同じ）
    await evictDurableObject(stub, { webSockets: "hibernate" });
    expect(await c.call("whoami")).toMatchObject({ role: "host" });
    c.close();
  });

  it("クライアントからの setState は拒否される", async () => {
    const c = await connectAgent("bingo-room", "smoke-4");
    await c.waitFor((f) => f.type === "cf_agent_state");
    c.ws.send(JSON.stringify({ type: "cf_agent_state", state: { name: "hacked" } }));
    await c.waitFor((f) => f.type === "cf_agent_state_error");
    const room = await getAgentByName(env.BingoRoom, "smoke-4");
    const state = await room.state;
    expect(state.name).toBe("");
    c.close();
  });

  it("RoomDirectory から BingoRoom を呼べる（Agent どうしの呼び出し）", async () => {
    const c = await connectAgent("room-directory", "main");
    expect(await c.call("pingRoom", "smoke-5")).toEqual({
      ok: true,
      room: "smoke-5",
      from: "main",
    });
    c.close();
  });
});
