"use client";

// S-03 参加コード印刷（docs/design/screens.md 5章）。印刷物なので Tailwind で直接書く（ADR 0006）
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { CodeEntry } from "@/agents/types";
import { formatJoinCode } from "@/lib/join-code";
import { errorMessage } from "@/lib/error-messages";
import { hostTokenStore } from "@/lib/client-storage";
import { ConnectionBanner } from "@/components/connection-banner";
import { END_TEXT, useBingoRoom, type RoomAgent } from "@/hooks/use-bingo-room";
import { useHostToken } from "../host-screen";

type Filter = "unused" | "all";

export function PrintSheet({ roomId }: { roomId: string }) {
  const token = useHostToken(roomId);
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  });
  const [filter, setFilter] = useState<Filter>("unused");
  const filterRef = useRef(filter);
  const [codes, setCodes] = useState<CodeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (a: RoomAgent, f: Filter) => {
    const t = tokenRef.current;
    if (!t) return;
    const auth = await a.stub.authHost(t);
    if (!auth.ok) {
      if (auth.error === "BAD_TOKEN") hostTokenStore.set(roomId, null);
      setError(errorMessage(auth.error));
      return;
    }
    const res = await a.stub.listCodes(f);
    if (res.ok) setCodes(res.codes);
    else setError(errorMessage(res.error));
  }, [roomId]);

  const { agent, state, connected, ended } = useBingoRoom(roomId, {
    onOpen: (a) => void load(a, filterRef.current),
  });

  // URL を読むのが接続より遅かったときも読み込む
  const loadedOnce = useRef(false);
  useEffect(() => {
    if (!token || !connected || loadedOnce.current) return;
    loadedOnce.current = true;
    void load(agent, filterRef.current);
  }, [token, connected, agent, load]);

  const changeFilter = (f: Filter) => {
    filterRef.current = f;
    setFilter(f);
    setCodes(null);
    void load(agent, f);
  };

  if (ended) return <Message text={END_TEXT[ended]} />;
  if (token === null) return <Message text="司会画面から開いてください" />;
  if (error) return <Message text={error} />;

  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const shortUrl = `${origin.replace(/^https?:\/\//, "")}/room/${roomId}`;
  const name = state?.name ?? "";

  return (
    <div className="min-h-dvh bg-white text-black">
      <ConnectionBanner connected={connected} />
      {/* 画面だけに出す操作（印刷では消す） */}
      <div className="flex flex-wrap items-center gap-3 border-b bg-neutral-100 p-4 print:hidden">
        <Link href={`/host/${roomId}`} className="rounded-md border border-neutral-400 px-3 py-2">
          ← 司会画面に戻る
        </Link>
        <fieldset className="flex gap-3">
          <legend className="sr-only">印刷するコード</legend>
          <label className="flex items-center gap-1">
            <input type="radio" name="filter" checked={filter === "unused"} onChange={() => changeFilter("unused")} />
            未使用のコードだけ
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="filter" checked={filter === "all"} onChange={() => changeFilter("all")} />
            すべて（無効にしたコードは除く）
          </label>
        </fieldset>
        <span className="text-sm">{codes ? `${codes.length}枚（A4 ${Math.ceil(codes.length / 12)}枚）` : "読み込んでいます…"}</span>
        <button
          className="ml-auto rounded-md bg-neutral-900 px-4 py-2 font-bold text-white disabled:opacity-40"
          disabled={!codes || codes.length === 0}
          onClick={() => window.print()}
        >
          印刷する
        </button>
      </div>

      {codes?.length === 0 && <p className="p-8 text-center print:hidden">印刷するコードがありません。司会画面で発行してください</p>}

      {/* A4 1枚に 3×4＝12枚。点線が切り取り線 */}
      {codes && codes.length > 0 && (
        <div className="mx-auto w-[210mm] print:w-auto">
          {chunk(codes, 12).map((page, i) => (
            <section
              key={i}
              className="grid h-[297mm] grid-cols-3 grid-rows-4 break-after-page p-[8mm] print:h-[281mm] print:p-0"
            >
              {page.map((c) => (
                <article
                  key={c.code}
                  className="flex flex-col items-center justify-center gap-[1mm] border border-dashed border-neutral-500 px-[3mm] py-[2mm] text-center *:shrink-0"
                >
                  {/* 長いルーム名は文字を小さくして折り返す（ROOM_NAME_MAX＝40文字でも収まる） */}
                  <p className={`line-clamp-3 w-full font-bold leading-tight break-words ${nameSize(name)}`}>{name}</p>
                  <QRCodeSVG value={`${origin}/room/${roomId}?c=${c.code}`} size={96} level="M" marginSize={1} />
                  {/* 見出しとコードを1行にして高さを節約する。「使用済み」は見出しの下に小さく */}
                  <div className="flex items-center gap-[1.5mm]">
                    <p className="flex flex-col text-[8pt] leading-tight">
                      <span>参加コード</span>
                      {c.status === "used" && <span className="text-[7pt] text-neutral-500">（使用済み）</span>}
                    </p>
                    <p className="font-mono text-[18pt] leading-tight font-black tracking-widest">{formatJoinCode(c.code)}</p>
                  </div>
                  <p className="text-[7pt] leading-tight">
                    QR が読めないときは
                    <br />
                    <span className="font-mono">{shortUrl}</span>
                    <br />
                    を開いてコードを入力
                  </p>
                  <p className="text-[7pt] leading-tight font-bold">この紙はなくさないでください（端末を変えたときに使います）</p>
                </article>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** ルーム名の文字の大きさ（1枚の幅は約58mm。短い名前は大きく1行、長い名前は小さくして3行まで） */
function nameSize(name: string): string {
  if (name.length <= 14) return "text-[11pt]";
  if (name.length <= 30) return "text-[9pt]";
  return "text-[8pt]";
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function Message({ text }: { text: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center p-4">
      <p className="w-full rounded-xl border bg-card p-6 text-center text-lg font-bold">{text}</p>
    </main>
  );
}
