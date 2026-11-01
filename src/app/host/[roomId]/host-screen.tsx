"use client";

// S-02 司会画面（docs/design/screens.md 4章）。shadcn/ui で作る（ADR 0006）
import { useCallback, useEffect, useRef, useState } from "react";
import type { CodeCounts, CodeEntry, Failure, HostParticipant, RoomPublicState } from "@/agents/types";
import { hostTokenStore, takeUrlParam } from "@/lib/client-storage";
import { errorMessage } from "@/lib/error-messages";
import { ConnectionBanner } from "@/components/connection-banner";
import { downloadText } from "@/components/copy-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { END_TEXT, useBingoRoom, type RoomAgent } from "@/hooks/use-bingo-room";
import { ProgressTab } from "./progress-tab";
import { ParticipantsTab } from "./participants-tab";
import { CodesTab } from "./codes-tab";

/** URL の ?t= を読んで消し、タブの中に保存する。なければ保存したもの（security.md 3章） */
export function useHostToken(roomId: string): string | null | undefined {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const taken = useRef(false);
  useEffect(() => {
    if (taken.current) return;
    taken.current = true;
    const fromUrl = takeUrlParam("t");
    if (fromUrl) hostTokenStore.set(roomId, fromUrl);
    const value = fromUrl ?? hostTokenStore.get(roomId);
    // 保存場所（sessionStorage）は描画の外でしか読めないので、ここで反映する
    queueMicrotask(() => setToken(value));
  }, [roomId]);
  return token;
}

export function HostScreen({ roomId }: { roomId: string }) {
  const token = useHostToken(roomId);
  const tokenRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    tokenRef.current = token;
  });
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<HostParticipant[]>([]);
  const [counts, setCounts] = useState<CodeCounts | null>(null);
  const [codes, setCodes] = useState<CodeEntry[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastDrawAt, setLastDrawAt] = useState<number | null>(null);
  const drawnCount = useRef<number | null>(null);

  const auth = useCallback(async (a: RoomAgent) => {
    const t = tokenRef.current;
    if (!t) return;
    const res = await a.stub.authHost(t);
    if (res.ok) {
      setAuthed(true);
      setAuthError(null);
    } else {
      setAuthed(false);
      if (res.error === "BAD_TOKEN") hostTokenStore.set(roomId, null);
      setAuthError(errorMessage(res.error));
    }
  }, [roomId]);

  const agentRef = useRef<RoomAgent | null>(null);
  const { agent, state, connected, ended } = useBingoRoom(roomId, {
    onOpen: (a) => {
      agentRef.current = a;
      void auth(a);
    },
    onMessage: (m) => {
      if (m.type === "host:participants") setParticipants(m.participants);
      if (m.type === "host:codes") {
        setCounts({ issued: m.issued, used: m.used, unused: m.unused, revoked: m.revoked });
        // コードの枚数が変わったら一覧も読み直す（host:codes は司会の接続にだけ届く）
        void agentRef.current?.stub.listCodes("all").then((res) => {
          if (res.ok) setCodes(res.codes);
        });
      }
    },
    onState: (s) => {
      // 新しい番号を受け取った時刻（3秒の待ち時間の表示に使う）
      if (drawnCount.current !== null && s.drawn.length > drawnCount.current) setLastDrawAt(Date.now());
      drawnCount.current = s.drawn.length;
    },
  });

  // つながったあとにトークンが読めた場合（URL を読むのが接続より遅かったとき）も名乗る
  useEffect(() => {
    if (token && connected && !authed && !authError) void auth(agent);
  }, [token, connected, authed, authError, agent, auth]);

  const run = async <T,>(fn: () => Promise<({ ok: true } & T) | Failure>): Promise<(({ ok: true } & T)) | null> => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fn();
      if (!res.ok) {
        // 3秒以内の抽選（COOLDOWN）は何もしない（画面に残り時間を出している）
        if (res.error !== "COOLDOWN") setMessage(errorMessage(res.error));
        return null;
      }
      return res;
    } catch {
      setMessage(errorMessage(undefined));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    const res = await run(() => agent.stub.exportResults());
    if (res && state) downloadText(`${state.name}-結果.csv`, res.csv);
  };

  if (ended) return <CenterMessage text={END_TEXT[ended]} />;
  if (token === null) return <CenterMessage text="司会用 URL から開いてください（管理画面の一覧から開けます）" />;
  if (authError) return <CenterMessage text={authError} />;

  const ready = state && authed;
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const canEdit = state?.status !== "finished";

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <ConnectionBanner connected={connected} />
      <header className="flex items-center justify-between gap-2">
        <h1 className="truncate text-xl font-bold">{state?.name ?? "　"}</h1>
        <span className="shrink-0 text-sm">{connected ? "● 接続中" : "○ 再接続中"}</span>
      </header>
      {message && (
        <p role="alert" className="rounded-md border border-destructive bg-destructive/15 p-3 text-sm">
          {message}
        </p>
      )}
      {!ready ? (
        <p className="text-muted-foreground">読み込んでいます…</p>
      ) : (
        <Tabs defaultValue="progress">
          <TabsList className="w-full">
            <TabsTrigger value="progress">進行</TabsTrigger>
            <TabsTrigger value="participants">参加者</TabsTrigger>
            <TabsTrigger value="codes">参加コード</TabsTrigger>
          </TabsList>
          <TabsContent value="progress" className="pt-3">
            <ProgressTab
              state={state as RoomPublicState}
              lastDrawAt={lastDrawAt}
              participants={participants}
              busy={busy}
              onStart={() => void run(() => agent.stub.start())}
              onDraw={() => void run(() => agent.stub.draw())}
              onFinish={() => void run(() => agent.stub.finish())}
              onExport={() => void exportCsv()}
              screenUrl={`${origin}/screen/${roomId}`}
              playerUrl={`${origin}/room/${roomId}`}
            />
          </TabsContent>
          <TabsContent value="participants" className="pt-3">
            <ParticipantsTab
              participants={participants}
              canEdit={canEdit}
              onShowCode={async (p) => (await run(() => agent.stub.getParticipantCode(p.id)))?.code ?? null}
              onReplaceCode={async (p) => (await run(() => agent.stub.replaceParticipantCode(p.id)))?.code ?? null}
              onRemove={async (p) => {
                await run(() => agent.stub.removeParticipant(p.id));
              }}
              onExport={() => void exportCsv()}
            />
          </TabsContent>
          <TabsContent value="codes" className="pt-3">
            <CodesTab
              roomId={roomId}
              counts={counts}
              codes={codes}
              canIssue={canEdit}
              busy={busy}
              onIssue={(n) => void run(() => agent.stub.issueCodes(n))}
              onRevoke={(code) => void run(() => agent.stub.revokeCode(code))}
            />
          </TabsContent>
        </Tabs>
      )}
    </main>
  );
}

function CenterMessage({ text }: { text: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center p-4">
      <p className="w-full rounded-xl border bg-card p-6 text-center text-lg font-bold">{text}</p>
    </main>
  );
}
