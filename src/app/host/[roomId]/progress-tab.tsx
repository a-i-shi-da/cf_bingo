"use client";

// S-02 進行タブ（docs/design/screens.md 4-1・4-4・4-5）
import { useEffect, useRef, useState } from "react";
import type { HostParticipant, RoomPublicState } from "@/agents/types";
import { MAX_NUMBER, formatBall, isLateJoinClosed } from "@/lib/bingo";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/copy-field";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** 抽選のあと、次を受け付けない時間（演出と同じ約3秒） */
const COOLDOWN_MS = 3000;
/** 抽選の確認を出してから、押せるようになるまで（連打で押されないように） */
const CONFIRM_GUARD_MS = 500;

type Props = {
  state: RoomPublicState;
  /** 新しい番号を受け取った時刻（画面の時計）。開いた時点の番号は null */
  lastDrawAt: number | null;
  participants: HostParticipant[];
  busy: boolean;
  onStart: () => void;
  onDraw: () => void;
  onFinish: () => void;
  onExport: () => void;
  screenUrl: string;
  playerUrl: string;
};

export function ProgressTab(props: Props) {
  const { state, participants } = props;
  const online = participants.filter((p) => p.online).length;
  const last = state.drawn.at(-1);
  const remaining = useCooldown(props.lastDrawAt);
  const allDrawn = state.drawn.length >= MAX_NUMBER;
  const [finishOpen, setFinishOpen] = useState(false);

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <Stat label="状態" value={{ waiting: "開始前", playing: "ゲーム中", finished: "終了" }[state.status]} />
        <Stat label="抽選" value={`${state.drawn.length} / ${MAX_NUMBER} 回`} />
        <Stat label="参加" value={`${state.participantCount}人（オンライン ${online}）`} />
        <Stat label="リーチ／ビンゴ" value={`${state.reachCount}人 ／ ${state.winners.length}人`} />
      </dl>

      {state.status === "playing" && isLateJoinClosed(state.drawn) && (
        <p role="status" className="rounded-md border border-destructive bg-destructive/15 p-3 text-sm font-bold">
          途中参加の受付は終了しました（ある列の番号をすべて引いたため）。受付で参加コードを配るのをやめてください
        </p>
      )}

      {state.status !== "finished" && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-muted-foreground">最後の番号</p>
          <p className="rounded-xl border-4 border-primary px-8 py-2 text-5xl font-black text-primary tabular-nums">
            {last ? formatBall(last) : "—"}
          </p>
        </div>
      )}

      {state.status === "waiting" && (
        <Button size="lg" className="h-20 w-full text-2xl" disabled={props.busy} onClick={props.onStart}>
          開始
        </Button>
      )}

      {state.status === "playing" && (
        <>
          <DrawButton disabled={props.busy || remaining > 0 || allDrawn} remaining={remaining} onDraw={props.onDraw} />
          {allDrawn && <p className="text-center font-bold">すべての番号を引きました。「終了」を押してください</p>}
        </>
      )}

      {state.status === "finished" && (
        <FinishedSummary state={state} onExport={props.onExport} />
      )}

      {state.drawn.length > 0 && (
        <p className="text-sm break-words">
          <span className="font-bold">引いた番号：</span>
          {state.drawn.map(formatBall).join(" ")}
        </p>
      )}

      <div className="space-y-3 rounded-lg border p-3">
        <CopyField label="投影画面の URL（投影用 PC で開く）" value={props.screenUrl} />
        <CopyField label="参加者用の URL（QR が読めない人の手入力用）" value={props.playerUrl} />
      </div>

      {state.status === "playing" && (
        // 「抽選」から離して、小さく一番下に置く（誤操作を防ぐ。game-rules 2章）
        <div className="border-t pt-10">
          <Button variant="outline" size="sm" onClick={() => setFinishOpen(true)}>
            終了
          </Button>
        </div>
      )}

      <AlertDialog open={finishOpen} onOpenChange={setFinishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ゲームを終了しますか？</AlertDialogTitle>
            <AlertDialogDescription>終了すると、もう抽選できません。この操作は元に戻せません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            {/* 最初に選ばれているのは「いいえ」 */}
            <AlertDialogCancel autoFocus>いいえ</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={() => {
                setFinishOpen(false);
                props.onFinish();
              }}
            >
              終了する
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-bold">{value}</dd>
    </div>
  );
}

/**
 * 抽選ボタンと確認（4-4）。押した場所に重ねて「抽選する」を少し上にずらして出す。
 * 表示から 0.5秒は押せない。外か「やめる」で閉じる。PC はスペースで開く → Enter で抽選、Esc でやめる
 */
function DrawButton({ disabled, remaining, onDraw }: { disabled: boolean; remaining: number; onDraw: () => void }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      setArmed(true);
      confirmRef.current?.focus();
    }, CONFIRM_GUARD_MS);
    return () => {
      clearTimeout(timer);
      setArmed(false);
    };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      if (!open && e.code === "Space" && !disabled) {
        e.preventDefault();
        setOpen(true);
      } else if (open && e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, disabled]);

  const confirm = () => {
    if (!armed) return;
    setOpen(false);
    onDraw();
  };

  return (
    <div className="relative pt-16">
      <Button
        size="lg"
        className="h-24 w-full text-3xl tracking-[0.5em]"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {remaining > 0 ? `抽選（あと ${Math.ceil(remaining / 1000)}秒）` : "抽選"}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <div role="dialog" aria-label="抽選の確認" className="absolute inset-x-0 -top-2 z-50 flex flex-col items-center gap-3">
            <Button
              ref={confirmRef}
              size="lg"
              className="h-24 w-4/5 text-3xl"
              disabled={!armed}
              onClick={confirm}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirm();
                }
              }}
            >
              抽選する
            </Button>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              やめる
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * 前の抽選から3秒の残り時間（ms）。lastDrawAt は、画面が新しい番号を受け取った時刻
 * （サーバーとの時刻のずれを避けるため、画面の時計で数える）
 */
function useCooldown(lastDrawAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (lastDrawAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 200);
    const stop = setTimeout(() => clearInterval(timer), COOLDOWN_MS + 300);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [lastDrawAt]);
  if (lastDrawAt === null) return 0;
  return Math.min(COOLDOWN_MS, Math.max(0, lastDrawAt + COOLDOWN_MS - now));
}

/** 4-5 終了後 */
function FinishedSummary({ state, onExport }: { state: RoomPublicState; onExport: () => void }) {
  return (
    <div className="space-y-4 rounded-lg border-2 border-primary p-4">
      <p className="text-2xl font-black text-primary">終了しました</p>
      <ul className="space-y-1">
        {state.winners.length === 0 && <li className="text-muted-foreground">ビンゴした人はいません</li>}
        {state.winners.map((w) => (
          <li key={`${w.rank}-${w.nickname}`}>
            🏆{w.rank}位 {w.nickname}（{w.atSeq}回目）
          </li>
        ))}
      </ul>
      <Button size="lg" className="w-full" onClick={onExport}>
        CSV を書き出す
      </Button>
      {state.deleteAt && (
        <p className="text-sm text-muted-foreground">
          このルームは {new Date(state.deleteAt).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" })}
          に自動で削除されます
        </p>
      )}
    </div>
  );
}
