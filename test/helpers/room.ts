import { env } from "cloudflare:workers";
import { getAgentByName } from "agents";
import type { BingoRoom, RoomDirectory } from "../worker";
import { connectAgent } from "./agent-socket";

export const roomStub = (roomId: string) =>
  getAgentByName(env.BingoRoom as unknown as DurableObjectNamespace<BingoRoom>, roomId);

export const directoryStub = () =>
  getAgentByName(env.RoomDirectory as unknown as DurableObjectNamespace<RoomDirectory>, "main");

let counter = 0;

/** 初期化したルームを作る（RoomDirectory の createRoom の代わり） */
export async function createRoom(name = "テストルーム") {
  const roomId = `room-${Date.now()}-${++counter}`;
  const hostToken = `host-token-${crypto.randomUUID()}`;
  const stub = await roomStub(roomId);
  const res = await stub.initRoom(name, hostToken);
  if (!res.ok) throw new Error(`initRoom failed: ${res.error}`);
  return { roomId, hostToken, stub };
}

export type TestRoom = Awaited<ReturnType<typeof createRoom>>;

/** 司会として名乗った接続 */
export async function connectHost(room: TestRoom) {
  const c = await connectAgent("bingo-room", room.roomId);
  const res = (await c.call("authHost", room.hostToken)) as { ok: boolean };
  if (!res.ok) throw new Error("authHost failed");
  return c;
}

/** 参加コードを発行する */
export async function issueCodes(host: Awaited<ReturnType<typeof connectHost>>, count: number) {
  const res = (await host.call("issueCodes", count)) as { ok: true; codes: string[] };
  return res.codes;
}

/** 参加者として参加した接続 */
export async function connectPlayer(room: TestRoom, code: string, nickname: string) {
  const c = await connectAgent("bingo-room", room.roomId);
  const res = (await c.call("join", code, nickname)) as { ok: boolean; error?: string };
  if (!res.ok) throw new Error(`join failed: ${res.error}`);
  return c;
}
