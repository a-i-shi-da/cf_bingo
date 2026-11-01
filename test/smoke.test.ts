import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { connectAgent } from "./helpers/agent-socket";
import { createRoom } from "./helpers/room";

describe("Phase 2 疎通確認", () => {
  it("BingoRoom に WebSocket でつなぐと公開 state が届く", async () => {
    const room = await createRoom("疎通");
    const c = await connectAgent("bingo-room", room.roomId);
    const frame = await c.waitFor((f) => f.type === "cf_agent_state");
    expect(frame.state).toMatchObject({ status: "waiting", drawn: [], name: "疎通", roomId: room.roomId });
    c.close();
  });

  it("callable（ping）が返る", async () => {
    const room = await createRoom();
    const c = await connectAgent("bingo-room", room.roomId);
    expect(await c.call("ping")).toMatchObject({ ok: true, name: room.roomId });
    c.close();
  });

  it("callable から呼んだ接続を取り出し、役割を記録できる", async () => {
    const room = await createRoom();
    const a = await connectAgent("bingo-room", room.roomId);
    const b = await connectAgent("bingo-room", room.roomId);
    await a.call("whoami", "host");
    expect(await a.call("whoami")).toMatchObject({ role: "host" });
    // 別の接続には影響しない
    expect(await b.call("whoami")).toMatchObject({ role: "guest" });
    a.close();
    b.close();
  });

  it("役割はハイバネーション（休止）から戻ったあとも残る", async () => {
    const room = await createRoom();
    const c = await connectAgent("bingo-room", room.roomId);
    await c.call("whoami", "host");
    // メモリから追い出す。WebSocket はつないだまま（本番のハイバネーションと同じ）
    await evictDurableObject(room.stub, { webSockets: "hibernate" });
    expect(await c.call("whoami")).toMatchObject({ role: "host" });
    c.close();
  });

  it("クライアントからの setState は拒否される", async () => {
    const room = await createRoom("元の名前");
    const c = await connectAgent("bingo-room", room.roomId);
    await c.waitFor((f) => f.type === "cf_agent_state");
    c.ws.send(JSON.stringify({ type: "cf_agent_state", state: { name: "hacked" } }));
    await c.waitFor((f) => f.type === "cf_agent_state_error");
    const state = await room.stub.state;
    expect(state.name).toBe("元の名前");
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
