// 負荷試験（docs/test-plan.md 5章）。画面と同じ通信（WebSocket＋callable）で 110 接続を張り、抽選を75回行う。
//
//   pnpm load-test                                  … 手元の pnpm preview（http://localhost:8787）に向けて
//   pnpm load-test https://bingo.example.workers.dev … Cloudflare 上の Worker に向けて
//
// 管理画面の合言葉は、環境変数 LOAD_ADMIN_PASSPHRASE か .dev.vars の ADMIN_PASSPHRASE から読む（表示しない）。
// すべての接続を1つのプロセスで動かすので、「抽選を送った時刻」と「各接続が受け取った時刻」を同じ時計で測れる。
// 試験用のルームは最後に削除する。
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { RoomPublicState } from "../src/agents/types";

// ───────────────────────── 設定

const BASE_URL = (process.argv[2] ?? process.env.LOAD_BASE_URL ?? "http://localhost:8787").replace(/\/$/, "");
const PLAYERS = Number(process.env.LOAD_PLAYERS ?? 100);
/** 司会1＋参加者のほかに張る投影画面の数（合計 110 接続にする） */
const SCREENS = Number(process.env.LOAD_SCREENS ?? 9);
const DRAWS = Number(process.env.LOAD_DRAWS ?? 75);
/** 途中で切ってつなぎ直す参加者の数と、切る・戻す抽選回 */
const RECONNECT_PLAYERS = Number(process.env.LOAD_RECONNECT ?? 10);
const DISCONNECT_AT = Math.min(20, Math.max(2, Math.floor(DRAWS / 3)));
const RECONNECT_AT = DISCONNECT_AT + Math.min(5, Math.max(1, Math.floor(DRAWS / 6)));
/** 1回の抽選で、全接続が受け取るのを待つ上限（これを過ぎたら取りこぼしと数える） */
const RECEIVE_TIMEOUT_MS = 5000;
/** サーバーの抽選の間隔（3秒）に少し足す */
const DRAW_INTERVAL_MS = 3100;
/** 参加を同時に送る数（受付に人が並ぶ様子に近づける） */
const JOIN_CONCURRENCY = 10;

// ───────────────────────── 道具

function passphrase(): string {
  const fromEnv = process.env.LOAD_ADMIN_PASSPHRASE;
  if (fromEnv) return fromEnv;
  try {
    const line = readFileSync(".dev.vars", "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("ADMIN_PASSPHRASE="));
    const value = line?.slice("ADMIN_PASSPHRASE=".length).trim().replace(/^"(.*)"$/, "$1");
    if (value) return value;
  } catch {
    // 下で知らせる
  }
  throw new Error("合言葉がありません。LOAD_ADMIN_PASSPHRASE か .dev.vars の ADMIN_PASSPHRASE を設定してください");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now();

type Frame = { type: string; [key: string]: unknown };

/** 1本の WebSocket。受信量と、抽選の回数ごとに state を受け取った時刻を記録する */
class Conn {
  ws!: WebSocket;
  bytes = 0;
  frames = 0;
  /** drawn.length → 初めて受け取った時刻 */
  arrivals = new Map<number, number>();
  drawnCount = -1;
  status: string | null = null;
  messages: Frame[] = [];
  closedWith: number | null = null;
  private seq = 0;
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private stateWaiters: (() => void)[] = [];

  readonly label: string;
  private readonly path: string;

  constructor(label: string, path: string) {
    this.label = label;
    this.path = path;
  }

  async open(): Promise<void> {
    const url = BASE_URL.replace(/^http/, "ws") + this.path;
    this.ws = new WebSocket(url);
    this.closedWith = null;
    this.ws.addEventListener("message", (event) => this.onMessage(event.data));
    this.ws.addEventListener("close", (event) => {
      this.closedWith = event.code;
      for (const p of this.pending.values()) p.reject(new Error(`${this.label}: closed ${event.code}`));
      this.pending.clear();
    });
    await new Promise<void>((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error(`${this.label}: 接続できません ${url}`)), { once: true });
    });
    // 最初の state（公開 state）が届くまで待つ
    await this.waitState(() => this.drawnCount >= 0, 10_000);
  }

  private onMessage(data: unknown) {
    const text = typeof data === "string" ? data : "";
    this.bytes += Buffer.byteLength(text);
    this.frames++;
    let frame: Frame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (frame.type === "cf_agent_state") {
      const state = frame.state as RoomPublicState | undefined;
      if (state?.drawn) {
        const t = now();
        if (!this.arrivals.has(state.drawn.length)) this.arrivals.set(state.drawn.length, t);
        this.drawnCount = state.drawn.length;
        this.status = state.status;
        for (const w of this.stateWaiters.splice(0)) w();
      }
      return;
    }
    if (frame.type === "rpc" && typeof frame.id === "string") {
      const p = this.pending.get(frame.id);
      if (!p) return;
      this.pending.delete(frame.id);
      if (frame.success) p.resolve(frame.result);
      else p.reject(new Error(`${this.label}: ${String(frame.error)}`));
      return;
    }
    this.messages.push(frame);
  }

  call<T = { ok: boolean; error?: string; [k: string]: unknown }>(method: string, ...args: unknown[]): Promise<T> {
    const id = `${this.label}-${++this.seq}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ type: "rpc", id, method, args }));
    });
  }

  /** 条件を満たす state が届くまで待つ（届かなければ false） */
  waitState(test: () => boolean, timeoutMs: number): Promise<boolean> {
    if (test()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      const check = () => {
        if (test()) {
          clearTimeout(timer);
          resolve(true);
        } else this.stateWaiters.push(check);
      };
      this.stateWaiters.push(check);
    });
  }

  close() {
    this.ws.close(1000);
  }
}

async function expectOk<T extends { ok: boolean; error?: string }>(what: string, p: Promise<T>): Promise<T> {
  const res = await p;
  if (!res.ok) throw new Error(`${what} に失敗しました: ${res.error}`);
  return res;
}

async function inBatches<T>(items: T[], size: number, fn: (item: T, index: number) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map((item, j) => fn(item, i + j)));
  }
}

function stats(values: number[]) {
  if (values.length === 0) return { n: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted[sorted.length - 1] };
}

const ms = (v: number) => `${Math.round(v)}ms`;
const kb = (v: number) => `${(v / 1024).toFixed(1)}KB`;

// ───────────────────────── 本体

async function main() {
  const pass = passphrase();
  const roomName = `負荷試験 ${new Date().toISOString().slice(0, 16)}`;
  const startedAt = Date.now();
  console.log(`負荷試験：${BASE_URL}  参加者 ${PLAYERS}・投影 ${SCREENS}・司会 1（合計 ${PLAYERS + SCREENS + 1} 接続）・抽選 ${DRAWS}回`);

  // 1. 管理画面と同じようにルームを作る
  const admin = new Conn("admin", "/agents/room-directory/main");
  await admin.open();
  const created = await expectOk(
    "ルームの作成",
    admin.call<{ ok: boolean; error?: string; roomId: string; hostUrl: string }>("createRoom", pass, roomName),
  );
  const roomId = created.roomId;
  const token = new URL(created.hostUrl).searchParams.get("t")!;
  console.log(`ルームを作りました：${roomId}`);

  const roomPath = `/agents/bingo-room/${roomId}`;
  const all: Conn[] = [];
  let deleted = false;
  const cleanup = async () => {
    if (deleted) return;
    deleted = true;
    for (const c of all) if (c.closedWith === null) c.close();
    // 削除すると BingoRoom は自分を止めるので、応答の代わりに例外が返ることがある（api.md 7章）
    const res = await admin.call("deleteRoom", pass, roomId, roomName).catch(() => ({ ok: true, error: undefined }));
    console.log(res.ok ? "試験用のルームを削除しました" : `ルームの削除に失敗しました（管理画面から削除してください）: ${res.error}`);
    admin.close();
  };

  try {
    // 2. 司会：名乗ってコードを発行する
    const host = new Conn("host", roomPath);
    all.push(host);
    await host.open();
    await expectOk("司会の名乗り", host.call("authHost", token));
    const issued = await expectOk(
      "コードの発行",
      host.call<{ ok: boolean; error?: string; codes: string[] }>("issueCodes", PLAYERS),
    );

    // 3. 投影画面
    const screens = Array.from({ length: SCREENS }, (_, i) => new Conn(`screen${i}`, roomPath));
    all.push(...screens);
    await Promise.all(
      screens.map(async (s) => {
        await s.open();
        await expectOk("投影の名乗り", s.call("authScreen"));
      }),
    );

    // 4. 参加者：つないで参加する
    const players = issued.codes.map((code, i) => ({ code, conn: new Conn(`p${i}`, roomPath) }));
    all.push(...players.map((p) => p.conn));
    const joinTimes: number[] = [];
    const joinStart = now();
    await inBatches(players, JOIN_CONCURRENCY, async (p, i) => {
      const t0 = now();
      await p.conn.open();
      await expectOk(`参加（${i}）`, p.conn.call("join", p.code, `負荷${String(i).padStart(3, "0")}`));
      joinTimes.push(now() - t0);
    });
    console.log(`${PLAYERS}人が参加しました（${ms(now() - joinStart)}。1人あたり 接続＋参加 p95 ${ms(stats(joinTimes).p95)}）`);

    // 5. 開始
    await expectOk("開始", host.call("start"));
    await Promise.all(all.map((c) => c.waitState(() => c.status === "playing", RECEIVE_TIMEOUT_MS)));

    // 6. 抽選を繰り返す
    const reconnecting = players.slice(0, RECONNECT_PLAYERS);
    const offline = new Set<Conn>();
    type DrawResult = { seq: number; drawMs: number; latencies: number[]; missed: string[] };
    const draws: DrawResult[] = [];
    let reconnectResult: { ok: number; failed: string[]; caughtUp: number } | null = null;
    let lastDrawAt = 0;

    for (let seq = 1; seq <= DRAWS; seq++) {
      if (seq === DISCONNECT_AT && RECONNECT_PLAYERS > 0) {
        for (const p of reconnecting) {
          p.conn.close();
          offline.add(p.conn);
        }
        console.log(`  ${RECONNECT_PLAYERS}人の接続を切りました（${RECONNECT_AT}回目の前に戻します）`);
      }
      if (seq === RECONNECT_AT && RECONNECT_PLAYERS > 0) {
        // 新しい接続でつなぎ直し、保存したコードで復帰する（画面の動きと同じ）
        const failed: string[] = [];
        let caughtUp = 0;
        await Promise.all(
          reconnecting.map(async (p) => {
            try {
              p.conn.arrivals.clear();
              await p.conn.open();
              const res = await p.conn.call<{ ok: boolean; error?: string; self?: { card?: unknown } }>("resume", p.code);
              if (!res.ok || !res.self?.card) throw new Error(res.error ?? "カードがありません");
              if (p.conn.drawnCount === seq - 1) caughtUp++;
              offline.delete(p.conn);
            } catch (e) {
              failed.push(`${p.conn.label}: ${(e as Error).message}`);
            }
          }),
        );
        reconnectResult = { ok: RECONNECT_PLAYERS - failed.length, failed, caughtUp };
        console.log(`  ${reconnectResult.ok}人がつなぎ直して復帰しました（最新の ${seq - 1}回まで追いついた人 ${caughtUp}人）`);
      }

      const wait = lastDrawAt + DRAW_INTERVAL_MS - now();
      if (wait > 0) await sleep(wait);

      const active = all.filter((c) => !offline.has(c));
      const t0 = now();
      let res = await host.call<{ ok: boolean; error?: string }>("draw");
      while (!res.ok && res.error === "COOLDOWN") {
        await sleep(200);
        res = await host.call("draw");
      }
      if (!res.ok) throw new Error(`抽選（${seq}回目）に失敗しました: ${res.error}`);
      const drawMs = now() - t0;
      lastDrawAt = t0;

      await Promise.all(active.map((c) => c.waitState(() => c.drawnCount >= seq, RECEIVE_TIMEOUT_MS)));
      const latencies: number[] = [];
      const missed: string[] = [];
      for (const c of active) {
        const at = c.arrivals.get(seq);
        if (at === undefined) missed.push(c.label);
        else latencies.push(at - t0);
      }
      draws.push({ seq, drawMs, latencies, missed });
      const s = stats(latencies);
      console.log(
        `  ${String(seq).padStart(2)}回目  届いた ${latencies.length}/${active.length}  p50 ${ms(s.p50)}  p95 ${ms(s.p95)}  最大 ${ms(s.max)}` +
          (missed.length ? `  取りこぼし ${missed.length}` : ""),
      );
    }

    // 7. 終了
    await expectOk("終了", host.call("finish"));
    await sleep(1500); // 最後の host:participants（1秒ごと）まで受け取る

    // ───────────────────────── 集計
    const allLatencies = draws.flatMap((d) => d.latencies);
    const total = stats(allLatencies);
    const worstPerDraw = draws.map((d) => Math.max(0, ...d.latencies));
    const missedTotal = draws.reduce((n, d) => n + d.missed.length, 0);
    const playerBytes = players.map((p) => p.conn.bytes);
    const screenBytes = screens.map((s) => s.bytes);
    const result = {
      baseUrl: BASE_URL,
      startedAt: new Date(startedAt).toISOString(),
      durationSec: Math.round((Date.now() - startedAt) / 1000),
      connections: all.length,
      players: PLAYERS,
      draws: draws.length,
      join: stats(joinTimes),
      latency: total,
      drawsOver1s: worstPerDraw.filter((v) => v > 1000).length,
      drawsOver2s: worstPerDraw.filter((v) => v > 2000).length,
      missed: missedTotal,
      drawRpc: stats(draws.map((d) => d.drawMs)),
      bytes: {
        playerAvg: playerBytes.reduce((a, b) => a + b, 0) / playerBytes.length,
        playerMax: Math.max(...playerBytes),
        screenMax: Math.max(...screenBytes, 0),
        host: host.bytes,
      },
      reconnect: reconnectResult,
      perDraw: draws.map((d) => ({ seq: d.seq, ...stats(d.latencies), missed: d.missed.length })),
    };

    console.log("\n──────── 結果（docs/test-plan.md 5章の基準）");
    console.log(`抽選から全接続に届くまで：p50 ${ms(total.p50)}  p95 ${ms(total.p95)}  p99 ${ms(total.p99)}  最大 ${ms(total.max)}`);
    console.log(`  全員が1秒以内に届かなかった抽選 ${result.drawsOver1s}回 / 2秒を超えた抽選 ${result.drawsOver2s}回（基準：目標 1秒・上限 2秒）`);
    console.log(`取りこぼし：${missedTotal}件（基準：0件）`);
    console.log(
      `受信量（1ゲーム）：参加者 平均 ${kb(result.bytes.playerAvg)}・最大 ${kb(result.bytes.playerMax)}／投影 ${kb(result.bytes.screenMax)}／司会 ${kb(result.bytes.host)}（基準：参加者 数百KB 以内）`,
    );
    if (reconnectResult) {
      console.log(
        `再接続：${reconnectResult.ok}/${RECONNECT_PLAYERS}人が復帰、${reconnectResult.caughtUp}人が最新まで追いついた` +
          (reconnectResult.failed.length ? `（失敗：${reconnectResult.failed.join(", ")}）` : ""),
      );
    }
    console.log(`司会の draw の応答：p50 ${ms(result.drawRpc.p50)}  最大 ${ms(result.drawRpc.max)}`);

    mkdirSync("load/results", { recursive: true });
    const file = `load/results/${new Date(startedAt).toISOString().replace(/[:.]/g, "-")}.json`;
    writeFileSync(file, JSON.stringify(result, null, 2));
    console.log(`記録：${file}`);

    const passed =
      result.drawsOver2s === 0 &&
      missedTotal === 0 &&
      result.bytes.playerMax < 1024 * 1024 &&
      (!reconnectResult || (reconnectResult.failed.length === 0 && reconnectResult.caughtUp === RECONNECT_PLAYERS));
    console.log(passed ? "\n合格（上限の基準をすべて満たしました）" : "\n不合格の項目があります");
    process.exitCode = passed ? 0 : 1;
  } finally {
    await cleanup();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
