// BingoRoom の結合テスト（docs/test-plan.md 3章）
import { evictDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { FREE, type Card } from "../src/lib/bingo";
import { connectAgent } from "./helpers/agent-socket";
import {
  connectHost,
  connectPlayer,
  createRoom,
  directoryStub,
  issueCodes,
  type TestRoom,
} from "./helpers/room";

// 列 B:1-5 / I:16-20 / N:31,32,FREE,33,34 / G:46-50 / O:61-65
const CARD: Card = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, FREE, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];
// B列を 6-10 にしたカード（1-5 では揃わない）
const CARD2: Card = CARD.map((row, r) => [6 + r, ...row.slice(1)]);

type Res = { ok: boolean; error?: string; [k: string]: unknown };
type Conn = Awaited<ReturnType<typeof connectAgent>>;

const call = (c: Conn, method: string, ...args: unknown[]) => c.call(method, ...args) as Promise<Res>;

/** 開始して、番号を順に引く（抽選の間隔は時計を進めて飛ばす） */
async function drawNumbers(room: TestRoom, host: Conn, numbers: number[]) {
  await room.stub.testSetNextNumbers(numbers);
  for (const _ of numbers) {
    const res = await call(host, "draw");
    expect(res.ok).toBe(true);
    await room.stub.testAdvance(3000);
  }
}

async function startedRoom() {
  const room = await createRoom();
  const host = await connectHost(room);
  return { room, host };
}

describe("初期化", () => {
  it("初期化していないルームにつなぐと room:not-found が届き、切られる", async () => {
    const c = await connectAgent("bingo-room", `no-such-room-${Date.now()}`);
    await c.waitFor((f) => f.type === "room:not-found");
    expect((await c.closed).code).toBe(4404);
  });

  it("2回目の初期化はできない。ルーム名をチェックする", async () => {
    const room = await createRoom();
    expect(await room.stub.initRoom("別の名前", "x".repeat(40))).toEqual({ ok: false, error: "ALREADY_INITIALIZED" });
    const other = await (await import("./helpers/room")).roomStub(`bad-name-${Date.now()}`);
    expect(await other.initRoom("   ", "x".repeat(40))).toEqual({ ok: false, error: "NAME_INVALID" });
    expect(await other.initRoom("あ".repeat(41), "x".repeat(40))).toEqual({ ok: false, error: "NAME_INVALID" });
  });
});

describe("権限（security 1章）", () => {
  it("違うトークンは BAD_TOKEN。名乗っていない接続・投影から司会の操作は FORBIDDEN", async () => {
    const room = await createRoom();
    const c = await connectAgent("bingo-room", room.roomId);
    expect(await call(c, "authHost", "wrong")).toEqual({ ok: false, error: "BAD_TOKEN" });
    for (const m of ["start", "draw", "finish", "exportResults"]) {
      expect(await call(c, m)).toEqual({ ok: false, error: "FORBIDDEN" });
    }
    expect(await call(c, "issueCodes", 1)).toEqual({ ok: false, error: "FORBIDDEN" });
    expect(await call(c, "authScreen")).toEqual({ ok: true });
    expect(await call(c, "start")).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("参加者になった接続も司会の操作はできない", async () => {
    const { room, host } = await startedRoom();
    const [code] = await issueCodes(host, 1);
    const p = await connectPlayer(room, code, "たろう");
    expect(await call(p, "start")).toEqual({ ok: false, error: "FORBIDDEN" });
  });

  it("司会トークンを5回間違えた接続は、次で RATE_LIMITED になり切られる", async () => {
    const room = await createRoom();
    const c = await connectAgent("bingo-room", room.roomId);
    for (let i = 0; i < 5; i++) expect((await call(c, "authHost", "wrong")).error).toBe("BAD_TOKEN");
    expect(await call(c, "authHost", room.hostToken)).toEqual({ ok: false, error: "RATE_LIMITED" });
    expect((await c.closed).code).toBe(4029);
  });

  it("司会として名乗ると host:participants と host:codes が届く", async () => {
    const room = await createRoom();
    const host = await connectHost(room);
    await host.waitFor((f) => f.type === "host:participants");
    expect(await host.waitFor((f) => f.type === "host:codes")).toMatchObject({ issued: 0, used: 0, unused: 0 });
  });
});

describe("参加の流れ（F-20・F-21）", () => {
  it("未使用のコードで参加 → 使用済みになる → 同じコードで復帰すると同じカード", async () => {
    const { room, host } = await startedRoom();
    const [code] = await issueCodes(host, 1);
    await room.stub.testSetNextCards([CARD]);

    const p1 = await connectAgent("bingo-room", room.roomId);
    const joined = await call(p1, "join", code.toLowerCase().replace(/^(...)/, "$1-"), " たろう ");
    expect(joined).toMatchObject({ ok: true, self: { nickname: "たろう", card: CARD, reachLines: 0, bingoRank: null } });
    await p1.waitFor((f) => f.type === "player:self" && f.nickname === "たろう");
    await host.waitFor((f) => f.type === "host:codes" && f.used === 1 && f.unused === 0);
    await host.waitFor(
      (f) => f.type === "host:participants" && (f.participants as { nickname: string }[]).some((p) => p.nickname === "たろう"),
    );

    // 別の端末で同じコード → 新しい参加者は作られず、同じカードに戻る
    const p2 = await connectAgent("bingo-room", room.roomId);
    expect(await call(p2, "resume", code)).toMatchObject({ ok: true, self: { nickname: "たろう", card: CARD } });
    // join に使用済みのコードが来たら、ニックネームを無視して復帰
    const p3 = await connectAgent("bingo-room", room.roomId);
    expect(await call(p3, "join", code, "じろう")).toMatchObject({ ok: true, self: { nickname: "たろう", card: CARD } });
    expect((await room.stub.state).participantCount).toBe(1);
  });

  it("参加の失敗：それぞれ正しいエラー", async () => {
    const { room, host } = await startedRoom();
    const [a, b, c, d] = await issueCodes(host, 4);
    await connectPlayer(room, a, "Taro");
    const x = await connectAgent("bingo-room", room.roomId);
    expect((await call(x, "join", "ZZZZZZ", "はなこ")).error).toBe("CODE_INVALID");
    expect((await call(x, "join", "abc", "はなこ")).error).toBe("CODE_INVALID");
    expect((await call(x, "join", b, "ｔａｒｏ")).error).toBe("NICKNAME_TAKEN"); // 全角・小文字でも重なる
    expect((await call(x, "join", b, "   ")).error).toBe("NICKNAME_INVALID");
    expect((await call(x, "join", b, "あ".repeat(21))).error).toBe("NICKNAME_INVALID");
    expect((await call(x, "resume", b)).error).toBe("CODE_UNUSED");
    expect(await call(host, "revokeCode", c)).toEqual({ ok: true });
    expect((await call(x, "join", c, "はなこ")).error).toBe("CODE_REVOKED");
    expect((await call(x, "resume", c)).error).toBe("CODE_REVOKED");
    // 使用済みのコードは無効にできない
    expect((await call(host, "revokeCode", a)).error).toBe("CODE_USED");
    expect((await call(host, "revokeCode", "ZZZZZZ")).error).toBe("NOT_FOUND");

    expect(await call(host, "start")).toEqual({ ok: true });
    expect(await call(host, "finish")).toEqual({ ok: true });
    expect((await call(x, "join", d, "はなこ")).error).toBe("ROOM_FINISHED");
    // 終了後も復帰はできる
    expect((await call(x, "resume", a)).ok).toBe(true);
  });

  it("101人目は ROOM_FULL", async () => {
    const { room, host } = await startedRoom();
    const codes = await issueCodes(host, 101);
    const c = await connectAgent("bingo-room", room.roomId);
    for (let i = 0; i < 100; i++) expect((await call(c, "join", codes[i], `p${i}`)).ok).toBe(true);
    expect((await call(c, "join", codes[100], "p100")).error).toBe("ROOM_FULL");
    expect((await room.stub.state).participantCount).toBe(100);
  });

  it("途中参加：それまでの番号でビンゴにならないカードを配り、どこかの列を引き切ったら LATE_JOIN_CLOSED", async () => {
    const { room, host } = await startedRoom();
    const [a, b, c] = await issueCodes(host, 3);
    await connectPlayer(room, a, "最初の人");
    await call(host, "start");
    await drawNumbers(room, host, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const late = await connectAgent("bingo-room", room.roomId);
    const res = (await call(late, "join", b, "途中の人")) as Res & { self: { card: Card; bingoRank: null } };
    expect(res.ok).toBe(true);
    expect(res.self.bingoRank).toBeNull();
    // B列の残り（11-15）を引き切る
    await drawNumbers(room, host, [11, 12, 13, 14, 15]);
    const x = await connectAgent("bingo-room", room.roomId);
    expect((await call(x, "join", c, "遅れた人")).error).toBe("LATE_JOIN_CLOSED");
    // 復帰はできる
    expect((await call(x, "resume", b)).ok).toBe(true);
  });
});

describe("抽選の流れ（F-04・F-05）", () => {
  it("開始 → 抽選で公開 state が全員に届き、本人にだけ player:self、司会にだけ host:participants", async () => {
    const { room, host } = await startedRoom();
    const [a, b] = await issueCodes(host, 2);
    await room.stub.testSetNextCards([CARD, CARD2]);
    const p1 = await connectPlayer(room, a, "p1");
    const p2 = await connectPlayer(room, b, "p2");
    const screen = await connectAgent("bingo-room", room.roomId);
    await call(screen, "authScreen");

    expect(await call(host, "start")).toEqual({ ok: true });
    await screen.waitFor((f) => f.type === "cf_agent_state" && (f.state as { status: string }).status === "playing");

    // 1-4 を引くと p1 は B列でリーチ（p2 は変わらない）
    await drawNumbers(room, host, [1, 2, 3, 4]);
    await screen.waitFor((f) => f.type === "cf_agent_state" && (f.state as { drawn: number[] }).drawn.length === 4);
    await p1.waitFor((f) => f.type === "player:self" && f.reachLines === 1 && f.card === undefined);
    expect(p2.messages("player:self").filter((f) => f.card === undefined)).toHaveLength(0);
    await host.waitFor(
      (f) =>
        f.type === "host:participants" &&
        (f.participants as { nickname: string; reachLines: number }[]).some((p) => p.nickname === "p1" && p.reachLines === 1),
    );
    expect(screen.messages("host:participants")).toHaveLength(0);
    expect(p1.messages("host:participants")).toHaveLength(0);
    expect((await room.stub.state).reachCount).toBe(1);
  });

  it("3秒以内の2回目は COOLDOWN。2つの司会接続からほぼ同時に呼んでも番号は1つ", async () => {
    const { room, host } = await startedRoom();
    const host2 = await connectHost(room);
    await call(host, "start");
    const [r1, r2] = await Promise.all([call(host, "draw"), call(host2, "draw")]);
    expect([r1.ok, r2.ok].sort()).toEqual([false, true]);
    expect([r1.error, r2.error]).toContain("COOLDOWN");
    expect((await room.stub.state).drawn).toHaveLength(1);
    // 実際の時間も少し進むので、余裕を持たせる
    await room.stub.testAdvance(2500);
    expect((await call(host, "draw")).error).toBe("COOLDOWN");
    await room.stub.testAdvance(500);
    expect((await call(host, "draw")).ok).toBe(true);
  });

  it("状態ごとのエラー：NOT_PLAYING・NOT_WAITING・NO_NUMBERS_LEFT", async () => {
    const { room, host } = await startedRoom();
    expect((await call(host, "draw")).error).toBe("NOT_PLAYING");
    expect((await call(host, "finish")).error).toBe("NOT_PLAYING");
    await call(host, "start");
    expect((await call(host, "start")).error).toBe("NOT_WAITING");
    for (let i = 0; i < 75; i++) {
      expect((await call(host, "draw")).ok).toBe(true);
      await room.stub.testAdvance(3000);
    }
    const drawn = (await room.stub.state).drawn;
    expect(new Set(drawn).size).toBe(75);
    expect((await call(host, "draw")).error).toBe("NO_NUMBERS_LEFT");
    await call(host, "finish");
    expect((await call(host, "draw")).error).toBe("NOT_PLAYING");
    expect((await call(host, "issueCodes", 1)).error).toBe("ROOM_FINISHED");
  });
});

describe("ビンゴと順位（game-rules 6章・F-23・F-24）", () => {
  it("同じ回は同着、次は人数分下がる。接続していない人も当選し、再接続で受け取る", async () => {
    const { room, host } = await startedRoom();
    const [a, b, c] = await issueCodes(host, 3);
    await room.stub.testSetNextCards([CARD, CARD, CARD2]);
    const p1 = await connectPlayer(room, a, "p1");
    const p2 = await connectPlayer(room, b, "p2");
    const p3 = await connectPlayer(room, c, "p3");
    // p2 は切断したまま
    p2.close();
    await call(host, "start");

    await drawNumbers(room, host, [1, 2, 3, 4, 5]); // 5回目で p1・p2 がビンゴ
    await p1.waitFor((f) => f.type === "player:self" && f.bingoRank === 1 && f.bingoAtSeq === 5);
    expect((await room.stub.state).winners).toEqual([
      { nickname: "p1", rank: 1, atSeq: 5 },
      { nickname: "p2", rank: 1, atSeq: 5 },
    ]);

    await drawNumbers(room, host, [61, 62, 63, 64, 65]); // 10回目で p3 がビンゴ → 3位
    await p3.waitFor((f) => f.type === "player:self" && f.bingoRank === 3 && f.bingoAtSeq === 10);
    // p1 は O列も揃ったが、記録は変わらない（揃ったライン数だけ増える）
    await p1.waitFor((f) => f.type === "player:self" && f.completedLines === 2 && f.bingoRank === 1);

    const state = await room.stub.state;
    expect(state.winners.map((w) => [w.nickname, w.rank])).toEqual([
      ["p1", 1],
      ["p2", 1],
      ["p3", 3],
    ]);
    expect(state.reachCount).toBe(0);

    // p2 が再接続すると、ビンゴしていたことが分かる
    const back = await connectAgent("bingo-room", room.roomId);
    expect(await call(back, "resume", b)).toMatchObject({ ok: true, self: { bingoRank: 1, bingoAtSeq: 5 } });
  });

  it("切断すると、司会の一覧でオフラインになる（2台のうち1台が残っていればオンライン）", async () => {
    const { room, host } = await startedRoom();
    const [a] = await issueCodes(host, 1);
    const p1 = await connectPlayer(room, a, "p1");
    const p1b = await connectAgent("bingo-room", room.roomId);
    await call(p1b, "resume", a);
    const online = (f: { type: string; [k: string]: unknown }, value: boolean) =>
      f.type === "host:participants" && (f.participants as { online: boolean }[])[0]?.online === value;
    await host.waitFor((f) => online(f, true));
    p1.close();
    await p1.closed;
    // 1台目を切っても、まだオンライン（host:participants は1秒に1回にまとめて送るので待つ）
    await new Promise((r) => setTimeout(r, 1200));
    expect(online(host.messages("host:participants").at(-1)!, true)).toBe(true);
    p1b.close();
    await host.waitFor((f) => online(f, false), 3000);
  }, 15_000);

  it("ハイバネーションのあとも、参加者の接続に結果が届く", async () => {
    const { room, host } = await startedRoom();
    const [a] = await issueCodes(host, 1);
    await room.stub.testSetNextCards([CARD]);
    const p1 = await connectPlayer(room, a, "p1");
    await call(host, "start");
    await evictDurableObject(room.stub, { webSockets: "hibernate" });
    // 追い出すと時計のずれも戻るので、間隔をあけずに1回だけ引く
    await room.stub.testSetNextNumbers([1, 2]);
    expect((await call(host, "draw")).ok).toBe(true);
    await room.stub.testAdvance(3000);
    expect((await call(host, "draw")).ok).toBe(true);
    await p1.waitFor((f) => f.type === "cf_agent_state" && (f.state as { drawn: number[] }).drawn.length === 2);
  });
});

describe("削除と差し替え（F-08・F-11・F-40）", () => {
  it("参加者を削除すると、接続が切られ、コードが使えなくなり、順位は付け直さない", async () => {
    const { room, host } = await startedRoom();
    const [a, b] = await issueCodes(host, 2);
    await room.stub.testSetNextCards([CARD, CARD2]);
    const p1 = await connectPlayer(room, a, "p1");
    await connectPlayer(room, b, "p2");
    await call(host, "start");
    await drawNumbers(room, host, [1, 2, 3, 4, 5]); // p1 が1位

    const list = (await host.waitFor(
      (f) => f.type === "host:participants" && (f.participants as { bingoRank: number | null }[]).some((p) => p.bingoRank === 1),
    )).participants as { id: string; nickname: string }[];
    const p1Id = list.find((p) => p.nickname === "p1")!.id;

    expect(await call(host, "removeParticipant", p1Id)).toEqual({ ok: true });
    await p1.waitFor((f) => f.type === "player:removed");
    expect((await p1.closed).code).toBe(4003);
    const state = await room.stub.state;
    expect(state.winners).toEqual([]);
    expect(state.participantCount).toBe(1);
    const x = await connectAgent("bingo-room", room.roomId);
    expect((await call(x, "resume", a)).error).toBe("CODE_REVOKED");
    expect((await call(host, "removeParticipant", p1Id)).error).toBe("NOT_FOUND");

    // p2 が次にビンゴしても 1位にはならない（削除した人の分も数える）
    await drawNumbers(room, host, [61, 62, 63, 64, 65]);
    expect((await room.stub.state).winners).toEqual([{ nickname: "p2", rank: 2, atSeq: 10 }]);
    // 削除した人のニックネームは、ほかの人が使える
    const [c] = await issueCodes(host, 1);
    expect((await call(x, "join", c, "p1")).ok).toBe(true);
  });

  it("コードを差し替えると、古いコードの接続が切られ、新しいコードで同じカードに戻る", async () => {
    const { room, host } = await startedRoom();
    const [a] = await issueCodes(host, 1);
    await room.stub.testSetNextCards([CARD]);
    const p1 = await connectPlayer(room, a, "p1");
    const list = (await host.waitFor(
      (f) => f.type === "host:participants" && (f.participants as unknown[]).length === 1,
    )).participants as { id: string }[];
    const id = list[0].id;
    expect(await call(host, "getParticipantCode", id)).toEqual({ ok: true, code: a });

    const replaced = (await call(host, "replaceParticipantCode", id)) as Res & { code: string };
    expect(replaced.ok).toBe(true);
    expect(replaced.code).not.toBe(a);
    await p1.waitFor((f) => f.type === "player:code-replaced");
    await p1.closed;
    expect(await call(host, "getParticipantCode", id)).toEqual({ ok: true, code: replaced.code });

    const x = await connectAgent("bingo-room", room.roomId);
    expect((await call(x, "resume", a)).error).toBe("CODE_REVOKED");
    expect(await call(x, "resume", replaced.code)).toMatchObject({ ok: true, self: { card: CARD, nickname: "p1" } });
    expect(await host.waitFor((f) => f.type === "host:codes" && f.revoked === 1)).toMatchObject({ used: 1, issued: 2 });
  });

  it("司会トークンを作り直すと、古いトークンの司会接続が切られ、古いトークンは使えない", async () => {
    const { room, host } = await startedRoom();
    const newToken = `new-token-${crypto.randomUUID()}`;
    expect(await room.stub.setHostToken(newToken)).toEqual({ ok: true });
    await host.waitFor((f) => f.type === "host:token-changed");
    expect((await host.closed).code).toBe(4001);
    const c = await connectAgent("bingo-room", room.roomId);
    expect((await call(c, "authHost", room.hostToken)).error).toBe("BAD_TOKEN");
    expect(await call(c, "authHost", newToken)).toEqual({ ok: true });
    expect((await call(c, "start")).ok).toBe(true);
  });
});

describe("参加コードの発行と一覧（F-02・F-03）", () => {
  it("150枚まで発行でき、151枚目は CODE_LIMIT。差し替えも上限に数える", async () => {
    const { room, host } = await startedRoom();
    const codes = await issueCodes(host, 150);
    expect(new Set(codes).size).toBe(150);
    expect((await call(host, "issueCodes", 1)).error).toBe("CODE_LIMIT");
    expect((await call(host, "issueCodes", 0)).error).toBe("INVALID_ARGUMENT");
    await connectPlayer(room, codes[0], "p1");
    const list = (await host.waitFor(
      (f) => f.type === "host:participants" && (f.participants as unknown[]).length === 1,
    )).participants as { id: string }[];
    expect((await call(host, "replaceParticipantCode", list[0].id)).error).toBe("CODE_LIMIT");
  });

  it("listCodes：unused は未使用だけ、all は無効を除くすべて（発行順）", async () => {
    const { room, host } = await startedRoom();
    const [a, b, c] = await issueCodes(host, 3);
    await connectPlayer(room, a, "p1");
    await call(host, "revokeCode", c);
    const unused = (await call(host, "listCodes", "unused")) as Res & { codes: { code: string }[] };
    expect(unused.codes.map((x) => x.code)).toEqual([b]);
    const all = (await call(host, "listCodes", "all")) as Res & { codes: { code: string; status: string }[] };
    expect(all.codes.map((x) => [x.code, x.status])).toEqual([
      [a, "used"],
      [b, "unused"],
    ]);
  });
});

describe("試行回数の制限（security 2-2）", () => {
  it("1つの接続で5回間違えたら、正しいコードでも RATE_LIMITED。1分たてば戻る", async () => {
    const { room, host } = await startedRoom();
    const [a] = await issueCodes(host, 1);
    const c = await connectAgent("bingo-room", room.roomId);
    for (let i = 0; i < 5; i++) expect((await call(c, "resume", "ZZZZZZ")).error).toBe("CODE_INVALID");
    expect((await call(c, "join", a, "p1")).error).toBe("RATE_LIMITED");
    // 別の接続には影響しない
    const other = await connectAgent("bingo-room", room.roomId);
    expect((await call(other, "resume", a)).error).toBe("CODE_UNUSED");
    await room.stub.testAdvance(60_000);
    expect((await call(c, "join", a, "p1")).ok).toBe(true);
  });

  it("ルーム全体で10分間に100回間違えたら、どの接続も RATE_LIMITED", async () => {
    const { room, host } = await startedRoom();
    const [a] = await issueCodes(host, 1);
    for (let i = 0; i < 20; i++) {
      const c = await connectAgent("bingo-room", room.roomId);
      for (let j = 0; j < 5; j++) await call(c, "resume", "ZZZZZZ");
      c.close();
    }
    const fresh = await connectAgent("bingo-room", room.roomId);
    expect((await call(fresh, "join", a, "p1")).error).toBe("RATE_LIMITED");
    await room.stub.testAdvance(10 * 60_000);
    expect((await call(fresh, "join", a, "p1")).ok).toBe(true);
  });
});

describe("公開 state の中身（security 1章）", () => {
  it("司会トークン・参加コード・カード・ビンゴしていない人の名前が入っていない", async () => {
    const { room, host } = await startedRoom();
    const [a, b] = await issueCodes(host, 2);
    await room.stub.testSetNextCards([CARD, CARD2]);
    const viewer = await connectAgent("bingo-room", room.roomId);
    await connectPlayer(room, a, "当選する人");
    await connectPlayer(room, b, "当選しない人");
    await call(host, "start");
    await drawNumbers(room, host, [1, 2, 3, 4, 5]);

    const states = viewer.messages("cf_agent_state").map((f) => JSON.stringify(f.state));
    const text = states.join("\n") + JSON.stringify(await room.stub.state);
    expect(text).not.toContain(room.hostToken);
    expect(text).not.toContain(a);
    expect(text).not.toContain(b);
    expect(text).not.toContain("当選しない人");
    expect(text).toContain("当選する人");
    expect(text).not.toContain("card");
    // 名乗っていない接続には個別メッセージが届かない
    expect(viewer.frames.filter((f) => /^(player|host):/.test(f.type))).toEqual([]);
  });
});

describe("結果の書き出し（F-10）", () => {
  it("BOM 付きの CSV。ビンゴ → リーチ → 参加順に並ぶ", async () => {
    const { room, host } = await startedRoom();
    const [a, b, c] = await issueCodes(host, 3);
    await room.stub.testSetNextCards([CARD2, CARD, CARD2]);
    await connectPlayer(room, a, "=参加者A"); // 式の対策
    await connectPlayer(room, b, "参加者B");
    await connectPlayer(room, c, "参加者C");
    await call(host, "start");
    await drawNumbers(room, host, [1, 2, 3, 4, 5, 61, 62, 63]);

    const res = (await call(host, "exportResults")) as Res & { csv: string };
    const lines = res.csv.split("\r\n");
    expect(lines[0]).toBe("﻿順位,ニックネーム,ビンゴした抽選回,リーチ数,揃ったライン数,参加した日時,参加時の抽選回数");
    expect(lines[1]).toMatch(/^1,参加者B,5,0,1,/);
    expect(lines[2]).toMatch(/^,'=参加者A,,0,0,.*,0$/);
    expect(lines[3]).toMatch(/^,参加者C,,0,0,/);
    expect(res.csv).not.toContain(a);
  });
});

describe("RoomDirectory への通知と削除（F-15・F-18・F-19）", () => {
  it("開始・終了を RoomDirectory に知らせる", async () => {
    const { room, host } = await startedRoom();
    await call(host, "start");
    await call(host, "finish");
    const deleteAt = (await room.stub.state).deleteAt;
    // 通知は操作の処理を待たせない（後から届く）ので、届くまで待つ
    const dir = await directoryStub();
    await expect.poll(() => dir.testReceived(room.roomId)).toHaveLength(2);
    expect(await dir.testReceived(room.roomId)).toEqual([
      { status: "playing", deleteAt: null },
      { status: "finished", deleteAt },
    ]);
  });

  it("作成時に30日後、終了時に7日後の確認を予約する", async () => {
    const { room, host } = await startedRoom();
    const before = await room.stub.testSchedules();
    expect(before).toHaveLength(1);
    expect(before[0].callback).toBe("checkExpiry");
    expect(before[0].time * 1000 - Date.now()).toBeGreaterThan(29 * 24 * 3600_000);
    await call(host, "start");
    await call(host, "finish");
    const after = await room.stub.testSchedules();
    const deleteAt = (await room.stub.state).deleteAt!;
    expect(after.map((s) => s.time * 1000)).toContain(Math.floor(deleteAt / 1000) * 1000);
  });

  it("終了から7日たつと、全員に room:deleted を送って削除し、RoomDirectory に知らせる", async () => {
    const { room, host } = await startedRoom();
    const [a] = await issueCodes(host, 1);
    const p1 = await connectPlayer(room, a, "p1");
    await call(host, "start");
    await call(host, "finish");
    await room.stub.testAdvance(7 * 24 * 3600_000 - 1000);
    await room.stub.checkExpiry();
    expect(p1.messages("room:deleted")).toHaveLength(0);
    await room.stub.testAdvance(1000);
    await room.stub.checkExpiry().catch(() => {}); // destroy で中断されることがある
    await p1.waitFor((f) => f.type === "room:deleted");
    await host.waitFor((f) => f.type === "room:deleted");
    expect((await p1.closed).code).toBe(4410);
    expect(await (await directoryStub()).testReceived(room.roomId)).toContain("deleted");
    const again = await connectAgent("bingo-room", room.roomId);
    await again.waitFor((f) => f.type === "room:not-found");
  });

  it("放置されたルームは最後に使われてから30日で削除。使うたびに延びる", async () => {
    const room = await createRoom();
    await room.stub.testAdvance(20 * 24 * 3600_000);
    const host = await connectHost(room); // 使われた
    host.close();
    await room.stub.testAdvance(20 * 24 * 3600_000);
    await room.stub.checkExpiry();
    const viewer = await connectAgent("bingo-room", room.roomId);
    await viewer.waitFor((f) => f.type === "cf_agent_state");
    expect(viewer.messages("room:not-found")).toHaveLength(0);
    // ここで接続したので、さらに30日
    await room.stub.testAdvance(30 * 24 * 3600_000);
    await room.stub.checkExpiry().catch(() => {});
    await viewer.waitFor((f) => f.type === "room:deleted");
  });

  it("つないだままの司会の操作（CSV の書き出しなど）も「使われた」に数える", async () => {
    const room = await createRoom();
    const host = await connectHost(room);
    await room.stub.testAdvance(20 * 24 * 3600_000);
    expect((await call(host, "exportResults")).ok).toBe(true);
    await room.stub.testAdvance(20 * 24 * 3600_000);
    await room.stub.checkExpiry();
    expect(host.messages("room:deleted")).toHaveLength(0);
    expect((await call(host, "listCodes", "all")).ok).toBe(true);
  });

  it("手で削除：ゲーム中は ROOM_PLAYING。開始前・終了後は削除できる", async () => {
    const { room, host } = await startedRoom();
    await call(host, "start");
    expect(await room.stub.deleteRoom()).toEqual({ ok: false, error: "ROOM_PLAYING" });
    await call(host, "finish");
    await room.stub.deleteRoom().catch(() => {});
    await host.waitFor((f) => f.type === "room:deleted");

    const waiting = await createRoom();
    const viewer = await connectAgent("bingo-room", waiting.roomId);
    await waiting.stub.deleteRoom().catch(() => {});
    await viewer.waitFor((f) => f.type === "room:deleted");
  });
});
