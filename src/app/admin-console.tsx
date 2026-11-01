"use client";

// S-01 管理画面（docs/design/screens.md 3章）。合言葉 → ルームの一覧・作成・削除・司会用 URL
import { useCallback, useEffect, useState } from "react";
import { useAgent } from "agents/react";
import type { RoomDirectory } from "@/agents/room-directory";
import type { Failure, RoomEntry, RoomStatus } from "@/agents/types";
import { errorMessage } from "@/lib/error-messages";
import { ConnectionBanner } from "@/components/connection-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/** 合言葉はタブの中だけに保存する（タブを閉じたら消える。security.md 4章） */
const PASS_KEY = "bingo:admin-passphrase";

const STATUS_LABEL: Record<RoomStatus, string> = { waiting: "開始前", playing: "ゲーム中", finished: "終了" };

const formatDate = (ms: number) => new Date(ms).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });

function readPass(): string | null {
  try {
    return sessionStorage.getItem(PASS_KEY);
  } catch {
    return null;
  }
}

function writePass(pass: string | null) {
  try {
    if (pass === null) sessionStorage.removeItem(PASS_KEY);
    else sessionStorage.setItem(PASS_KEY, pass);
  } catch {
    // 保存できなくても、このページを開いている間は使える
  }
}

/** 開いているダイアログ */
type DialogState =
  | { kind: "created"; name: string; hostUrl: string }
  | { kind: "url"; room: RoomEntry; hostUrl: string; regenerated?: boolean }
  | { kind: "regenerate"; room: RoomEntry }
  | { kind: "delete"; room: RoomEntry }
  | null;

export function AdminConsole() {
  const [connected, setConnected] = useState(false);
  const [pass, setPass] = useState<string | null>(null);
  const [passInput, setPassInput] = useState("");
  const [rooms, setRooms] = useState<RoomEntry[] | null>(null);
  const [newName, setNewName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirmName, setConfirmName] = useState("");

  const dir = useAgent<RoomDirectory>({
    agent: "RoomDirectory",
    name: "main",
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
  });

  /** 合言葉が違う・締め出されたときは、入力画面に戻す */
  const handleFailure = useCallback((res: Failure) => {
    if (res.error === "BAD_PASSPHRASE" || res.error === "RATE_LIMITED") {
      writePass(null);
      setPass(null);
      setRooms(null);
    }
    // 管理画面で NOT_FOUND が返るのは、ルームが一覧にないとき
    setMessage(res.error === "NOT_FOUND" ? "ルームが見つかりません。一覧を読み込み直してください" : errorMessage(res.error));
  }, []);

  const refresh = useCallback(
    async (p: string) => {
      const res = await dir.stub.listRooms(p);
      if (res.ok) setRooms(res.rooms);
      else handleFailure(res);
    },
    [dir, handleFailure],
  );

  // 前にこのタブで入れた合言葉があれば、それで開く
  useEffect(() => {
    if (!connected || pass !== null) return;
    const saved = readPass();
    if (!saved) return;
    void (async () => {
      const res = await dir.stub.listRooms(saved);
      if (!res.ok) return handleFailure(res);
      setPass(saved);
      setRooms(res.rooms);
    })();
  }, [connected, pass, dir, handleFailure]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch {
      setMessage(errorMessage(undefined));
    } finally {
      setBusy(false);
    }
  };

  const unlock = () =>
    run(async () => {
      const res = await dir.stub.checkPassphrase(passInput);
      if (!res.ok) return handleFailure(res);
      writePass(passInput);
      setPass(passInput);
      setPassInput("");
      await refresh(passInput);
    });

  const create = () =>
    run(async () => {
      if (!pass) return;
      const res = await dir.stub.createRoom(pass, newName);
      if (!res.ok) return handleFailure(res);
      setDialog({ kind: "created", name: newName.trim(), hostUrl: res.hostUrl });
      setNewName("");
      await refresh(pass);
    });

  const regenerate = (room: RoomEntry) =>
    run(async () => {
      if (!pass) return;
      const res = await dir.stub.regenerateHostToken(pass, room.roomId);
      if (!res.ok) {
        setDialog(null);
        return handleFailure(res);
      }
      setDialog({ kind: "url", room, hostUrl: res.hostUrl, regenerated: true });
      await refresh(pass);
    });

  const remove = (room: RoomEntry) =>
    run(async () => {
      if (!pass) return;
      const res = await dir.stub.deleteRoom(pass, room.roomId, confirmName);
      setDialog(null);
      setConfirmName("");
      if (!res.ok) return handleFailure(res);
      setMessage(`ルーム「${room.name}」を削除しました`);
      await refresh(pass);
    });

  const lock = () => {
    writePass(null);
    setPass(null);
    setRooms(null);
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4">
      <ConnectionBanner connected={connected} />
      <header>
        <h1 className="text-2xl font-bold text-primary">ビンゴ大会 管理</h1>
      </header>

      {message && (
        <p role="status" className="rounded-md border border-primary/40 bg-card p-3 text-sm">
          {message}
        </p>
      )}

      {pass === null ? (
        // 3-1 合言葉の入力
        <Card className="mx-auto max-w-sm">
          <CardHeader>
            <CardTitle>合言葉</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void unlock();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="passphrase">合言葉</Label>
                <Input
                  id="passphrase"
                  type="password"
                  autoComplete="current-password"
                  value={passInput}
                  onChange={(e) => setPassInput(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={!connected || busy || passInput === ""}>
                開く
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        // 3-2 管理画面（一覧＋作成）
        <>
          <Card>
            <CardHeader>
              <CardTitle>＋ 新しいルームを作る</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <Label htmlFor="room-name" className="sr-only">
                  ルーム名
                </Label>
                <Input
                  id="room-name"
                  placeholder="ルーム名（例：忘年会2026）"
                  maxLength={40}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Button type="submit" disabled={!connected || busy || newName.trim() === ""}>
                  作成
                </Button>
              </form>
            </CardContent>
          </Card>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">ルーム一覧</h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => refresh(pass))}>
                  読み込み直す
                </Button>
                <Button variant="ghost" size="sm" onClick={lock}>
                  閉じる
                </Button>
              </div>
            </div>
            {rooms === null ? (
              <p className="text-sm text-muted-foreground">読み込んでいます…</p>
            ) : rooms.length === 0 ? (
              <p className="text-sm text-muted-foreground">まだルームはありません</p>
            ) : (
              <ul className="space-y-2">
                {rooms.map((room) => (
                  <li key={room.roomId} className="rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold break-all">{room.name}</span>
                      <Badge variant={room.status === "playing" ? "default" : "secondary"}>
                        {STATUS_LABEL[room.status]}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        作成 {formatDate(room.createdAt)}
                        {room.deleteAt !== null && ` ／ 削除予定 ${formatDate(room.deleteAt)}`}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" asChild>
                        <a href={room.hostUrl} target="_blank" rel="noopener noreferrer">
                          司会画面
                        </a>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "url", room, hostUrl: room.hostUrl })}>
                        URL
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDialog({ kind: "regenerate", room })}>
                        URL を作り直す
                      </Button>
                      {/* ゲーム中は削除できない（F-19） */}
                      {room.status !== "playing" && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            setConfirmName("");
                            setDialog({ kind: "delete", room });
                          }}
                        >
                          削除
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {/* 3-3 作成したあと／司会用 URL の表示 */}
      <AlertDialog open={dialog?.kind === "created" || dialog?.kind === "url"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          {(dialog?.kind === "created" || dialog?.kind === "url") && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {dialog.kind === "created"
                    ? "ルームを作成しました"
                    : dialog.regenerated
                      ? "新しい司会用 URL を作りました"
                      : `「${dialog.room.name}」の司会用 URL`}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  この URL は司会だけで共有してください。この URL は管理画面の一覧からも確認できます。
                  {dialog.kind === "url" && dialog.regenerated && " 前の URL はもう使えません。"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <HostUrlBox url={dialog.hostUrl} />
              <AlertDialogFooter>
                <AlertDialogCancel>閉じる</AlertDialogCancel>
                <AlertDialogAction asChild>
                  <a href={dialog.hostUrl}>司会画面へ進む</a>
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* URL を作り直す（確認） */}
      <AlertDialog open={dialog?.kind === "regenerate"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          {dialog?.kind === "regenerate" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>「{dialog.room.name}」の司会用 URL を作り直しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  今の URL はすぐに使えなくなり、開いている司会画面は切断されます。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>いいえ</AlertDialogCancel>
                <Button disabled={busy} onClick={() => void regenerate(dialog.room)}>
                  作り直す
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* 3-4 ルームの削除（ルーム名を入れるまで押せない） */}
      <AlertDialog open={dialog?.kind === "delete"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          {dialog?.kind === "delete" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>ルーム「{dialog.room.name}」を削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  参加者・カード・結果がすべて消え、元に戻せません。確認のため、ルーム名を入力してください。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Label htmlFor="confirm-name" className="sr-only">
                ルーム名
              </Label>
              <Input id="confirm-name" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
              <AlertDialogFooter>
                <AlertDialogCancel>いいえ</AlertDialogCancel>
                <Button
                  variant="destructive"
                  disabled={busy || confirmName.trim() !== dialog.room.name}
                  onClick={() => void remove(dialog.room)}
                >
                  削除する
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

/** 司会用 URL の表示とコピー */
function HostUrlBox({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="司会用 URL" />
      <Button
        variant="outline"
        size="sm"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "コピーしました" : "コピー"}
      </Button>
    </div>
  );
}
