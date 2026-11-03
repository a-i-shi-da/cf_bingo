"use client";

// S-05 投影画面（docs/design/screens.md 7章）。表示だけで、操作はしない。Tailwind で直接書く（ADR 0006）
import { useEffect, useRef, useState } from "react";
import type { RoomPublicState, Winner } from "@/agents/types";
import { DRAW_REVEAL_MS, MAX_NUMBER, columnLetter, formatBall } from "@/lib/bingo";
import { ConnectionBanner } from "@/components/connection-banner";
import { END_TEXT, useBingoRoom } from "@/hooks/use-bingo-room";
import { Sounds } from "./sounds";

/** 抽選の演出の長さ（番号が決まるまでの切り替え。参加者画面もこの間は新しい番号を出さない） */
const ROLL_MS = DRAW_REVEAL_MS;
/** ビンゴの特別な演出を出しておく長さ */
const BINGO_MS = 7000;

export function ProjectorScreen({ roomId }: { roomId: string }) {
  const sounds = useRef<Sounds | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  /** 表示し終えた抽選の回数（演出中の番号はまだ数えない） */
  const [revealed, setRevealed] = useState<number | null>(null);
  const revealedRef = useRef<number | null>(null);
  const [rolling, setRolling] = useState<number | null>(null);
  const [bingo, setBingo] = useState<Winner[] | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const reveal = (count: number) => {
    revealedRef.current = count;
    setRevealed(count);
  };

  const startRoll = (s: RoomPublicState) => {
    const target = s.drawn.length;
    const finalNumber = s.drawn[target - 1];
    sounds.current?.drumroll(ROLL_MS / 1000);
    const spin = setInterval(() => setRolling(1 + Math.floor(Math.random() * MAX_NUMBER)), 70);
    timers.current.push(
      setTimeout(() => {
        clearInterval(spin);
        setRolling(null);
        reveal(target);
        const newWinners = s.winners.filter((w) => w.atSeq === target);
        if (newWinners.length > 0) {
          sounds.current?.fanfare();
          setBingo(newWinners);
          timers.current.push(setTimeout(() => setBingo(null), BINGO_MS));
        }
      }, ROLL_MS),
    );
    setRolling(finalNumber);
  };

  const { state, connected, ended } = useBingoRoom(roomId, {
    onOpen: (a) => void a.stub.authScreen(),
    onState: (s) => {
      const shown = revealedRef.current;
      const count = s.drawn.length;
      // 最初に開いたとき・2つ以上進んでいたとき（再接続）は演出なしで最新を出す
      if (shown === null || count !== shown + 1) {
        if (shown === null || count > shown) reveal(count);
        return;
      }
      startRoll(s);
    },
  });

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach(clearTimeout);
  }, []);

  if (ended) {
    return <div className="flex h-dvh items-center justify-center p-8 text-center text-4xl font-bold">{END_TEXT[ended]}</div>;
  }
  if (!state || revealed === null) {
    return <div className="flex h-dvh items-center justify-center text-3xl text-muted-foreground">読み込んでいます…</div>;
  }

  const shown = state.drawn.slice(0, revealed);
  const winners = state.winners.filter((w) => w.atSeq <= revealed);

  return (
    <div className="relative h-dvh overflow-hidden bg-background select-none">
      <ConnectionBanner connected={connected} />
      {/* 7-1 ブラウザの決まりで、一度クリックしないと音を鳴らせない */}
      {!soundOn && (
        <button
          className="absolute right-4 bottom-4 z-30 rounded-xl bg-primary px-6 py-3 text-xl font-bold text-primary-foreground"
          onClick={() => {
            sounds.current = new Sounds();
            setSoundOn(true);
          }}
        >
          クリックして開始（音を有効にする）
        </button>
      )}

      {state.status === "waiting" && (
        <div className="flex h-full flex-col items-center justify-center gap-[5vh] text-center">
          <h1 className="text-[7vh] font-black text-primary">🎉 {state.name} ビンゴ大会 🎉</h1>
          <p className="text-[4vh]">受付で配った参加コードの紙の QR を読んでください</p>
          <p className="text-[10vh] font-black">参加 {state.participantCount}人</p>
          <p className="text-[4vh] text-muted-foreground">まもなく開始します</p>
        </div>
      )}

      {state.status === "playing" && (
        <div className="grid h-full grid-cols-[3fr_2fr]">
          <section className="flex flex-col items-center justify-center gap-[3vh]">
            <div
              aria-live="polite"
              className={[
                "flex min-w-[60%] items-center justify-center rounded-[4vh] border-[1vh] border-primary px-[4vh] font-black tabular-nums",
                rolling !== null ? "text-[20vh] text-muted-foreground" : "text-[24vh] text-primary",
              ].join(" ")}
            >
              {rolling !== null ? formatBall(rolling) : shown.length > 0 ? formatBall(shown.at(-1)!) : "—"}
            </div>
            <p className="text-[5vh]">抽選 {rolling !== null ? state.drawn.length : shown.length}回目</p>
          </section>
          <aside className="flex flex-col gap-[2vh] border-l p-[2vh]">
            <NumberBoard drawn={shown} />
            <p className="text-[4vh] font-bold">リーチ {state.reachCount}人</p>
            <Winners winners={winners} title="🏆 ビンゴ" />
          </aside>
        </div>
      )}

      {state.status === "finished" && (
        <div className="flex h-full flex-col items-center justify-center gap-[4vh] p-[4vh]">
          <h1 className="text-[9vh] font-black text-primary">ビンゴ大会 終了！</h1>
          <Winners winners={state.winners} title="最終結果" large />
        </div>
      )}

      {/* ビンゴが出たときの特別な演出（同じ回の人は並べて「同着」） */}
      {bingo && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-[4vh] bg-background/90 text-center">
          <p className="animate-bounce text-[14vh] font-black text-primary">BINGO!</p>
          <p className="text-[7vh] font-black">
            {bingo.length > 1 ? `同着 ${bingo[0].rank}位` : `${bingo[0].rank}位`}
          </p>
          <p className="text-[8vh] font-black break-all">{bingo.map((w) => w.nickname).join("・")}</p>
        </div>
      )}
    </div>
  );
}

/** 75個の一覧。引いた番号を光らせる（色に加えて太字・枠でも区別する） */
function NumberBoard({ drawn }: { drawn: number[] }) {
  const set = new Set(drawn);
  const last = drawn.at(-1);
  return (
    <div className="grid grid-cols-[auto_repeat(15,1fr)] gap-[0.4vh] text-center text-[2.4vh]">
      {[0, 1, 2, 3, 4].map((col) => (
        <div key={col} className="contents">
          <div className="pr-[0.5vh] font-black text-primary">{columnLetter(col * 15 + 1)}</div>
          {Array.from({ length: 15 }, (_, i) => col * 15 + i + 1).map((n) => (
            <div
              key={n}
              className={[
                "rounded-[0.6vh] tabular-nums",
                set.has(n) ? "bg-primary font-black text-primary-foreground" : "text-muted-foreground/60",
                n === last ? "ring-[0.4vh] ring-foreground" : "",
              ].join(" ")}
            >
              {n}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** ビンゴした人を順位ごとにまとめて出す */
function Winners({ winners, title, large = false }: { winners: Winner[]; title: string; large?: boolean }) {
  const byRank = new Map<number, string[]>();
  for (const w of winners) byRank.set(w.rank, [...(byRank.get(w.rank) ?? []), w.nickname]);
  return (
    <section className={large ? "w-full max-w-[80vw] text-center" : "min-h-0 flex-1 overflow-hidden"}>
      <h2 className={large ? "mb-[2vh] text-[5vh] font-bold" : "text-[4vh] font-bold"}>{title}</h2>
      {winners.length === 0 ? (
        <p className="text-[3vh] text-muted-foreground">まだいません</p>
      ) : (
        <ul className={large ? "space-y-[1vh] text-[5vh]" : "space-y-[0.5vh] text-[3.2vh]"}>
          {[...byRank].map(([rank, names]) => (
            <li key={rank} className="break-all">
              <span className="font-black text-primary">{rank}位</span> {names.join("・")}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
