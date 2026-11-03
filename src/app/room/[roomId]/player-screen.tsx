"use client";

// S-04 参加者画面（docs/design/screens.md 6章）。軽い部品だけで作る（ADR 0006）
import { useEffect, useMemo, useRef, useState } from "react";
import type { ErrorCode, PlayerSelf, RoomPublicState, Winner } from "@/agents/types";
import { DRAW_REVEAL_MS, FREE, formatBall, markedCells, reachCells, type Card } from "@/lib/bingo";
import { celebratedStore, joinCodeStore, takeUrlParam } from "@/lib/client-storage";
import { errorMessage } from "@/lib/error-messages";
import { formatJoinCode, normalizeJoinCode } from "@/lib/join-code";
import { ConnectionBanner } from "@/components/connection-banner";
import { END_TEXT, useBingoRoom, type RoomAgent } from "@/hooks/use-bingo-room";

type Self = PlayerSelf & { card: Card };

/** 参加・復帰の結果 */
type AuthResult = { ok: true; self: PlayerSelf } | { ok: false; error: ErrorCode };

export function PlayerScreen({ roomId }: { roomId: string }) {
  const [self, setSelf] = useState<Self | null>(null);
  /** 名乗るのに使うコード（再接続したら、このコードで resume する） */
  const codeRef = useRef<string | null>(null);
  const [phase, setPhase] = useState<"checking" | "form" | "joined">("checking");
  const [codeInput, setCodeInput] = useState("");
  const [nickname, setNickname] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 起動時に URL や保存から読んだコード（最初につながったときに使う） */
  const initialCodeRef = useRef<{ code: string | null; fromUrl: boolean } | null>(null);

  const applySelfNow = (s: PlayerSelf) =>
    setSelf((prev) => (s.card ? (s as Self) : prev ? { ...prev, ...s, card: prev.card } : prev));
  const reveal = useDelayedReveal(applySelfNow);
  /** 抽選の演出中は、リーチ・ビンゴの知らせも番号と一緒に出す */
  const applySelf = reveal.applySelf;

  const resume = async (agent: RoomAgent, code: string): Promise<AuthResult> =>
    (await agent.stub.resume(code)) as AuthResult;

  /** 最初につながったとき：URL の ?c= か、保存したコードで復帰を試す */
  const firstAuth = async (agent: RoomAgent) => {
    const init = initialCodeRef.current;
    const code = init?.code;
    if (!code) {
      setPhase("form");
      return;
    }
    const res = await resume(agent, code);
    if (res.ok) {
      codeRef.current = code;
      joinCodeStore.set(roomId, code);
      applySelf(res.self);
      setPhase("joined");
      return;
    }
    setCodeInput(formatJoinCode(normalizeJoinCode(code) ?? code));
    if (res.error === "CODE_UNUSED") {
      // 個別 QR から開いた初めての人 → ニックネームを入れてもらう
      setPhase("form");
      return;
    }
    if (!init?.fromUrl) joinCodeStore.set(roomId, null);
    setFormError(errorMessage(res.error));
    setPhase("form");
  };

  const { agent, state: received, connected, ended } = useBingoRoom(roomId, {
    onState: reveal.onState,
    onOpen: (a) => {
      if (codeRef.current) {
        // 再接続：同じコードで名乗り直す
        void resume(a, codeRef.current).then((res) => {
          if (res.ok) applySelf(res.self);
        });
      } else {
        void firstAuth(a);
      }
    },
    onMessage: (m) => {
      if (m.type === "player:self") applySelf(m);
    },
  });

  // URL の ?c= を読み取ってすぐ消す（security.md 3章）。なければ保存したコード
  useEffect(() => {
    if (initialCodeRef.current) return;
    const fromUrl = takeUrlParam("c");
    initialCodeRef.current = fromUrl
      ? { code: fromUrl, fromUrl: true }
      : { code: joinCodeStore.get(roomId), fromUrl: false };
  }, [roomId]);

  // 削除・差し替えのあとは、保存したコードを消す
  useEffect(() => {
    if (ended === "removed" || ended === "code-replaced") joinCodeStore.set(roomId, null);
  }, [ended, roomId]);

  const submit = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const res = (await agent.stub.join(codeInput, nickname)) as AuthResult;
      if (!res.ok) {
        setFormError(errorMessage(res.error));
        return;
      }
      const code = normalizeJoinCode(codeInput) ?? codeInput;
      codeRef.current = code;
      joinCodeStore.set(roomId, code);
      applySelf(res.self);
      setPhase("joined");
    } catch {
      setFormError(errorMessage(undefined));
    } finally {
      setBusy(false);
    }
  };

  const state = reveal.state;
  if (ended) return <Message text={END_TEXT[ended]} />;

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pt-4 pb-10">
      <ConnectionBanner connected={connected} />
      {phase === "joined" && self && state ? (
        <CardView roomId={roomId} state={state} self={self} connected={connected} receivedCount={received?.drawn.length ?? 0} />
      ) : phase === "form" && state ? (
        <JoinForm
          roomName={state.name}
          code={codeInput}
          nickname={nickname}
          error={formError}
          busy={busy || !connected}
          onCode={setCodeInput}
          onNickname={setNickname}
          onSubmit={() => void submit()}
        />
      ) : (
        <p className="pt-20 text-center text-muted-foreground">読み込んでいます…</p>
      )}
    </main>
  );
}

function Message({ text }: { text: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <p className="w-full rounded-xl border bg-card p-6 text-center text-lg font-bold">{text}</p>
    </main>
  );
}

/** 6-1 参加（初めて開いたとき） */
function JoinForm(props: {
  roomName: string;
  code: string;
  nickname: string;
  error: string | null;
  busy: boolean;
  onCode: (v: string) => void;
  onNickname: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="space-y-5 pt-6"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
    >
      <header className="text-center">
        <p className="text-3xl">🎉</p>
        <h1 className="text-2xl font-bold text-primary break-all">{props.roomName}</h1>
        <p className="text-lg">ビンゴ大会</p>
      </header>
      <label className="block space-y-1">
        <span className="font-bold">参加コード</span>
        <input
          className="w-full rounded-lg border border-input bg-background px-3 py-3 text-2xl tracking-widest uppercase"
          value={props.code}
          onChange={(e) => props.onCode(e.target.value)}
          placeholder="K7P-3QX"
          autoComplete="off"
          autoCapitalize="characters"
          inputMode="text"
        />
      </label>
      <label className="block space-y-1">
        <span className="font-bold">ニックネーム</span>
        <input
          className="w-full rounded-lg border border-input bg-background px-3 py-3 text-xl"
          value={props.nickname}
          onChange={(e) => props.onNickname(e.target.value)}
          maxLength={20}
          autoComplete="nickname"
        />
        <span className="block text-sm text-muted-foreground">
          スクリーンや参加者の画面に表示されます。本名でなくてもかまいません
        </span>
      </label>
      {props.error && (
        <p role="alert" className="rounded-lg bg-destructive/20 p-3 font-bold">
          {props.error}
        </p>
      )}
      <button
        type="submit"
        disabled={props.busy || props.code.trim() === ""}
        className="w-full rounded-xl bg-primary py-4 text-xl font-bold text-primary-foreground disabled:opacity-50"
      >
        参加する
      </button>
    </form>
  );
}

/** 6-2 カード */
function CardView(props: { roomId: string; state: RoomPublicState; self: Self; connected: boolean; receivedCount: number }) {
  const { roomId, state, self, connected } = props;
  const drawn = state.drawn;
  const last = drawn.at(-1) ?? null;
  const marked = useMemo(() => markedCells(self.card, drawn), [self.card, drawn]);
  const reach = useMemo(
    () => new Set((self.bingoRank === null ? reachCells(self.card, drawn) : []).map(([r, c]) => `${r},${c}`)),
    [self.card, drawn, self.bingoRank],
  );
  // 演出待ちの番号は受け取り済みなので、表示した数ではなく受け取った数で比べる
  const missed = useMissedWhileOffline(connected, props.receivedCount);
  // ビンゴになったら（切れている間になっていた場合も）お祝い表示を出す。閉じたら、開き直しても出さない
  const [dismissed, setDismissed] = useState(() => celebratedStore.get(roomId));
  const celebrate = self.bingoRank !== null && !dismissed;

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-2">
        <h1 className="text-lg font-bold break-all">{self.nickname} さん</h1>
        <span className="shrink-0 text-sm">{connected ? "● 接続中" : "○ 再接続中"}</span>
      </header>
      {state.status !== "waiting" && (
        <p className="text-sm">
          抽選 {drawn.length}回 / 最後: <strong className="text-primary">{last ? formatBall(last) : "—"}</strong>
        </p>
      )}
      {missed > 0 && (
        <p role="status" className="rounded-lg bg-card p-2 text-center text-sm">
          切れている間に {missed}個の番号が引かれました
        </p>
      )}

      {/* ビンゴしたら、お祝い表示を閉じたあともカードの上に順位を出し続ける（6-2） */}
      {self.bingoRank !== null && (
        <div className="space-y-1 rounded-xl border-2 border-primary p-2 text-center">
          <p className="text-2xl font-black text-primary">
            🏆 {self.bingoRank}位でビンゴ！（{self.bingoAtSeq}回目）
          </p>
          {self.completedLines >= 2 && <p className="font-bold">{self.completedLines}本そろいました（当選は1回目のみ）</p>}
        </div>
      )}

      <table className="w-full table-fixed border-collapse text-center select-none" aria-label="ビンゴカード">
        <thead>
          <tr>
            {"BINGO".split("").map((l) => (
              <th key={l} className="pb-1 text-2xl font-black text-primary">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {self.card.map((row, r) => (
            <tr key={r}>
              {row.map((n, c) => {
                const isMarked = marked[r][c];
                const isLast = n !== FREE && n === last;
                const isReach = reach.has(`${r},${c}`);
                return (
                  <td key={c} className="p-0.5">
                    <div
                      data-marked={isMarked || undefined}
                      aria-label={`${n === FREE ? "FREE" : n}${isMarked ? " マーク済み" : ""}${isReach ? " リーチ" : ""}`}
                      className={[
                        "relative flex aspect-square items-center justify-center rounded-lg border-2 text-2xl font-bold",
                        isMarked ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
                        isReach ? "border-dashed border-primary" : "",
                        isLast ? "animate-pulse ring-4 ring-primary/70" : "",
                      ].join(" ")}
                    >
                      {n === FREE ? <span className="text-sm">FREE</span> : n}
                      {/* マーク済みは色だけでなく形（スタンプ）でも分かるようにする */}
                      {isMarked && n !== FREE && (
                        <span aria-hidden className="absolute inset-1 rounded-full border-4 border-primary-foreground/70" />
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <StatusLine state={state} self={self} />
      {state.status !== "waiting" && <WinnerList winners={state.winners} />}

      {celebrate && (
        <div role="dialog" aria-label="ビンゴ" className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-background/95 p-6 text-center">
          <p className="text-6xl">🏆</p>
          <p className="text-4xl font-black text-primary">{self.bingoRank}位でビンゴ！</p>
          <p className="text-xl">前に出てきてください</p>
          <button
            className="rounded-xl bg-primary px-8 py-3 text-lg font-bold text-primary-foreground"
            onClick={() => {
              celebratedStore.set(roomId);
              setDismissed(true);
            }}
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}

function StatusLine({ state, self }: { state: RoomPublicState; self: Self }) {
  if (state.status === "waiting") {
    return <p className="text-center text-lg">まもなく始まります（参加 {state.participantCount}人）</p>;
  }
  const lines: string[] = [];
  // ビンゴの順位はカードの上に出している
  if (self.bingoRank === null && self.reachLines > 0) {
    lines.push(`リーチ！（${self.reachLines}本）`);
  }
  if (state.status === "finished") lines.unshift("終了しました");
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1 text-center">
      {lines.map((l) => (
        <p key={l} className="text-2xl font-black text-primary">
          {l}
        </p>
      ))}
    </div>
  );
}

function WinnerList({ winners }: { winners: Winner[] }) {
  if (winners.length === 0) return null;
  return (
    <section className="rounded-xl border bg-card p-3">
      <h2 className="mb-1 font-bold">🏆 ビンゴした人</h2>
      <ul className="space-y-0.5">
        {winners.map((w) => (
          <li key={`${w.rank}-${w.nickname}`}>
            {w.rank}位 {w.nickname}（{w.atSeq}回目）
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 切れている間に引かれた番号の数（つながり直してから数秒だけ出す。screens.md 6-3） */
function useMissedWhileOffline(connected: boolean, drawnCount: number): number {
  const atDisconnect = useRef<number | null>(null);
  const drawnCountRef = useRef(drawnCount);
  const [missed, setMissed] = useState(0);
  useEffect(() => {
    drawnCountRef.current = drawnCount;
  });
  useEffect(() => {
    if (!connected) {
      if (atDisconnect.current === null) atDisconnect.current = drawnCountRef.current;
      return;
    }
    if (atDisconnect.current === null) return;
    const before = atDisconnect.current;
    // つながり直したあと、最新の state が届くのを少し待ってから数える
    const timer = setTimeout(() => {
      atDisconnect.current = null;
      setMissed(Math.max(0, drawnCountRef.current - before));
    }, 800);
    return () => clearTimeout(timer);
  }, [connected]);
  useEffect(() => {
    if (missed === 0) return;
    const timer = setTimeout(() => setMissed(0), 6000);
    return () => clearTimeout(timer);
  }, [missed]);
  return missed;
}

/**
 * 新しい番号は、投影画面のドラムロールが終わってから出す（screens.md 6-2）。
 * 1つだけ増えた state を受け取ったら DRAW_REVEAL_MS のあいだ表示を止め、その間に届いた
 * state と自分の情報（リーチ・ビンゴ）もためておいて、まとめて出す。
 * 最初に開いたとき・切れている間に2つ以上進んでいたときは待たずに出す（投影画面と同じ）。
 */
function useDelayedReveal(applySelfNow: (s: PlayerSelf) => void) {
  const [state, setState] = useState<RoomPublicState | null>(null);
  const shownCount = useRef<number | null>(null);
  const pending = useRef<{ state: RoomPublicState; selves: PlayerSelf[]; timer: ReturnType<typeof setTimeout> } | null>(null);
  const applySelfRef = useRef(applySelfNow);
  useEffect(() => {
    applySelfRef.current = applySelfNow;
  });

  const show = (s: RoomPublicState) => {
    shownCount.current = s.drawn.length;
    setState(s);
  };
  const flush = () => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.timer);
    pending.current = null;
    show(p.state);
    p.selves.forEach((s) => applySelfRef.current(s));
  };

  const onState = (s: RoomPublicState) => {
    const p = pending.current;
    if (p) {
      // 演出中に届いた同じ回の state（参加人数の変化・終了など）は、演出のあとに出す
      if (s.drawn.length === p.state.drawn.length) {
        p.state = s;
        return;
      }
      flush();
    }
    const shown = shownCount.current;
    if (shown !== null && s.status === "playing" && s.drawn.length === shown + 1) {
      pending.current = { state: s, selves: [], timer: setTimeout(flush, DRAW_REVEAL_MS) };
      return;
    }
    show(s);
  };

  const applySelf = (s: PlayerSelf) => {
    if (pending.current) pending.current.selves.push(s);
    else applySelfRef.current(s);
  };

  useEffect(() => () => clearTimeout(pending.current?.timer), []);

  return { state, onState, applySelf };
}
