// RoomDirectory の結合テスト（docs/test-plan.md 3章。F-01・F-16・F-19・F-40）
import { describe, expect, it } from "vitest";
import { connectAgent } from "./helpers/agent-socket";
import { directoryStub, roomStub } from "./helpers/room";

const PASS = "test-passphrase-0123"; // vitest.config.mts で設定した値

type Res = { ok: boolean; error?: string; [k: string]: unknown };
type Conn = Awaited<ReturnType<typeof connectAgent>>;
type Entry = { roomId: string; name: string; status: string; createdAt: number; deleteAt: number | null; hostUrl: string };

const call = (c: Conn, method: string, ...args: unknown[]) => c.call(method, ...args) as Promise<Res>;

let ipCounter = 0;
/** 管理画面の接続（テストごとに別の接続元にして、締め出しが混ざらないようにする） */
async function connectAdmin(ip = `10.0.0.${++ipCounter}`) {
  return connectAgent("room-directory", "main", { "CF-Connecting-IP": ip });
}

async function create(admin: Conn, name: string) {
  const res = (await call(admin, "createRoom", PASS, name)) as Res & { roomId: string; hostUrl: string };
  expect(res.ok).toBe(true);
  const token = new URL(res.hostUrl).searchParams.get("t")!;
  return { roomId: res.roomId, hostUrl: res.hostUrl, token };
}

async function list(admin: Conn): Promise<Entry[]> {
  const res = (await call(admin, "listRooms", PASS)) as Res & { rooms: Entry[] };
  expect(res.ok).toBe(true);
  return res.rooms;
}

async function connectHostWith(roomId: string, token: string) {
  const c = await connectAgent("bingo-room", roomId);
  expect(await call(c, "authHost", token)).toEqual({ ok: true });
  return c;
}

describe("合言葉（security 2章）", () => {
  it("違う合言葉では、どの操作も BAD_PASSPHRASE", async () => {
    const admin = await connectAdmin();
    expect(await call(admin, "checkPassphrase", "wrong")).toEqual({ ok: false, error: "BAD_PASSPHRASE" });
    expect((await call(admin, "listRooms", "wrong")).error).toBe("BAD_PASSPHRASE");
    expect((await call(admin, "createRoom", "wrong", "忘年会")).error).toBe("BAD_PASSPHRASE");
    expect((await call(admin, "regenerateHostToken", "wrong", "x")).error).toBe("BAD_PASSPHRASE");
    expect((await call(admin, "deleteRoom", "wrong", "x", "x")).error).toBe("BAD_PASSPHRASE");
    // 5回間違えたので、この接続元は締め出されている。別の接続元で続ける
    const other = await connectAdmin();
    expect((await call(other, "checkPassphrase", undefined)).error).toBe("BAD_PASSPHRASE");
    expect(await call(other, "checkPassphrase", PASS)).toEqual({ ok: true });
  });

  it("同じ接続元から10分間に5回間違えたら、10分間は正しい合言葉でも RATE_LIMITED", async () => {
    const ip = "10.9.9.9";
    const admin = await connectAdmin(ip);
    for (let i = 0; i < 5; i++) expect((await call(admin, "checkPassphrase", "wrong")).error).toBe("BAD_PASSPHRASE");
    expect((await call(admin, "checkPassphrase", PASS)).error).toBe("RATE_LIMITED");
    // 同じ接続元なら、つなぎ直しても締め出されたまま
    const again = await connectAdmin(ip);
    expect((await call(again, "listRooms", PASS)).error).toBe("RATE_LIMITED");
    // 別の接続元は影響を受けない
    expect((await call(await connectAdmin(), "checkPassphrase", PASS)).ok).toBe(true);
    await (await directoryStub()).testAdvance(10 * 60_000);
    expect((await call(again, "checkPassphrase", PASS)).ok).toBe(true);
  });

  it("main 以外の名前の RoomDirectory にはつなげない", async () => {
    const c = await connectAgent("room-directory", "other");
    expect((await c.closed).code).toBe(4404);
  });

  it("RoomDirectory には公開 state がなく、司会トークンは listRooms でしか返らない", async () => {
    const admin = await connectAdmin();
    const { token } = await create(admin, "秘密の確認");
    const viewer = await connectAdmin();
    await call(viewer, "checkPassphrase", "wrong");
    expect(JSON.stringify(viewer.frames)).not.toContain(token);
    expect(viewer.frames.filter((f) => f.type === "cf_agent_state" && f.state)).toEqual([]);
  });
});

describe("ルームの作成と一覧（F-01・F-16）", () => {
  it("作成すると司会用 URL が返り、そのトークンで司会になれる。一覧に出る", async () => {
    const admin = await connectAdmin();
    const { roomId, hostUrl, token } = await create(admin, "  忘年会2026  ");
    expect(hostUrl).toBe(`http://example.com/host/${roomId}?t=${token}`);
    expect(roomId).toMatch(/^[a-z0-9]{12}$/);
    expect(token.length).toBeGreaterThanOrEqual(43);

    const viewer = await connectAgent("bingo-room", roomId);
    const st = await viewer.waitFor((f) => f.type === "cf_agent_state");
    expect(st.state).toMatchObject({ roomId, name: "忘年会2026", status: "waiting" });
    await connectHostWith(roomId, token);

    const entry = (await list(admin)).find((r) => r.roomId === roomId)!;
    expect(entry).toMatchObject({ name: "忘年会2026", status: "waiting", deleteAt: null, hostUrl });
  });

  it("ルーム名が空・長すぎると NAME_INVALID", async () => {
    const admin = await connectAdmin();
    expect((await call(admin, "createRoom", PASS, "   ")).error).toBe("NAME_INVALID");
    expect((await call(admin, "createRoom", PASS, "あ".repeat(41))).error).toBe("NAME_INVALID");
    expect((await call(admin, "createRoom", PASS, 123)).error).toBe("NAME_INVALID");
  });

  it("一覧は作成が新しい順", async () => {
    const admin = await connectAdmin();
    const a = await create(admin, "古いルーム");
    await new Promise((r) => setTimeout(r, 5));
    const b = await create(admin, "新しいルーム");
    const ids = (await list(admin)).map((r) => r.roomId);
    expect(ids.indexOf(b.roomId)).toBeLessThan(ids.indexOf(a.roomId));
  });

  it("開始・終了すると一覧の状態と削除予定日が変わる", async () => {
    const admin = await connectAdmin();
    const { roomId, token } = await create(admin, "状態の確認");
    const host = await connectHostWith(roomId, token);
    await call(host, "start");
    await expect.poll(async () => (await list(admin)).find((r) => r.roomId === roomId)?.status).toBe("playing");
    await call(host, "finish");
    await expect.poll(async () => (await list(admin)).find((r) => r.roomId === roomId)?.status).toBe("finished");
    const deleteAt = (await (await roomStub(roomId)).state).deleteAt;
    expect((await list(admin)).find((r) => r.roomId === roomId)?.deleteAt).toBe(deleteAt);
  });

  it("期限で自動削除されたルームは一覧から消える", async () => {
    const admin = await connectAdmin();
    const { roomId, token } = await create(admin, "自動削除");
    const host = await connectHostWith(roomId, token);
    await call(host, "start");
    await call(host, "finish");
    const stub = await roomStub(roomId);
    await stub.testAdvance(7 * 24 * 3600_000);
    await stub.checkExpiry().catch(() => {});
    await expect.poll(async () => (await list(admin)).some((r) => r.roomId === roomId)).toBe(false);
  });
});

describe("司会用 URL の作り直し（F-40）", () => {
  it("古いトークンの司会接続は切られ、新しい URL で司会になれる", async () => {
    const admin = await connectAdmin();
    const { roomId, token } = await create(admin, "作り直し");
    const oldHost = await connectHostWith(roomId, token);
    const res = (await call(admin, "regenerateHostToken", PASS, roomId)) as Res & { hostUrl: string };
    expect(res.ok).toBe(true);
    const newToken = new URL(res.hostUrl).searchParams.get("t")!;
    expect(newToken).not.toBe(token);
    await oldHost.waitFor((f) => f.type === "host:token-changed");
    expect((await oldHost.closed).code).toBe(4001);

    const c = await connectAgent("bingo-room", roomId);
    expect((await call(c, "authHost", token)).error).toBe("BAD_TOKEN");
    await connectHostWith(roomId, newToken);
    expect((await list(admin)).find((r) => r.roomId === roomId)?.hostUrl).toBe(res.hostUrl);
  });

  it("一覧にないルームは NOT_FOUND", async () => {
    const admin = await connectAdmin();
    expect((await call(admin, "regenerateHostToken", PASS, "nosuchroom00")).error).toBe("NOT_FOUND");
  });
});

describe("ルームの削除（F-19）", () => {
  it("確認のルーム名が違えば NAME_MISMATCH、ゲーム中は ROOM_PLAYING。終了後は削除できる", async () => {
    const admin = await connectAdmin();
    const { roomId, token } = await create(admin, "削除するルーム");
    const host = await connectHostWith(roomId, token);
    expect((await call(admin, "deleteRoom", PASS, roomId, "削除する")).error).toBe("NAME_MISMATCH");
    await call(host, "start");
    expect((await call(admin, "deleteRoom", PASS, roomId, "削除するルーム")).error).toBe("ROOM_PLAYING");
    expect((await list(admin)).some((r) => r.roomId === roomId)).toBe(true);
    await call(host, "finish");
    expect(await call(admin, "deleteRoom", PASS, roomId, " 削除するルーム ")).toEqual({ ok: true });
    await host.waitFor((f) => f.type === "room:deleted");
    expect((await list(admin)).some((r) => r.roomId === roomId)).toBe(false);
    // 削除したルームにつなぐと room:not-found
    const c = await connectAgent("bingo-room", roomId);
    await c.waitFor((f) => f.type === "room:not-found");
    expect((await call(admin, "deleteRoom", PASS, roomId, "削除するルーム")).error).toBe("NOT_FOUND");
  });

  it("開始前のルームも削除できる", async () => {
    const admin = await connectAdmin();
    const { roomId } = await create(admin, "開始前");
    expect(await call(admin, "deleteRoom", PASS, roomId, "開始前")).toEqual({ ok: true });
    // 止まっている途中は呼び出しが失敗するので、消えるまで待つ
    await expect.poll(() => roomStub(roomId).then((s) => s.exists()).catch(() => "stopping")).toBe(false);
  });
});
