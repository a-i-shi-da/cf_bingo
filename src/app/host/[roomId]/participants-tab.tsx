"use client";

// S-02 参加者タブ（docs/design/screens.md 4-2。F-07〜F-11）
import { useMemo, useState } from "react";
import type { HostParticipant } from "@/agents/types";
import { formatJoinCode } from "@/lib/join-code";
import { compareParticipants } from "@/lib/results";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  participants: HostParticipant[];
  canEdit: boolean;
  onShowCode: (p: HostParticipant) => Promise<string | null>;
  onReplaceCode: (p: HostParticipant) => Promise<string | null>;
  onRemove: (p: HostParticipant) => Promise<void>;
  onExport: () => void;
};

type Dialog =
  | { kind: "code"; p: HostParticipant; code: string; replaced?: boolean }
  | { kind: "confirm-replace"; p: HostParticipant }
  | { kind: "confirm-remove"; p: HostParticipant }
  | null;

export function ParticipantsTab(props: Props) {
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);

  // 並び順：ビンゴ（順位順）→ リーチ（本数の多い順）→ そのほか（参加順）
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return props.participants
      .filter((p) => q === "" || p.nickname.toLowerCase().includes(q))
      .sort((a, b) => compareParticipants({ ...a, completedLines: 0 }, { ...b, completedLines: 0 }));
  }, [props.participants, query]);

  return (
    <div className="space-y-3">
      <Input placeholder="ニックネームで検索…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="ニックネームで検索" />
      <p className="text-sm text-muted-foreground">
        {props.participants.length}人 {query && `（${rows.length}人が当てはまります）`}
      </p>
      <ul className="divide-y rounded-lg border">
        {rows.map((p) => (
          <li key={p.id} className="flex items-center gap-2 p-2">
            <span className="w-20 shrink-0 text-sm font-bold">
              {p.bingoRank !== null ? `🏆${p.bingoRank}位` : p.reachLines > 1 ? `リーチ×${p.reachLines}` : p.reachLines === 1 ? "リーチ" : ""}
            </span>
            <span className="min-w-0 flex-1 truncate">{p.nickname}</span>
            {/* 記号と文字の両方で表す（色だけに頼らない） */}
            <span className="shrink-0 text-sm" title={p.online ? "オンライン" : "オフライン"}>
              {p.online ? "●" : "○"}
              <span className="sr-only">{p.online ? "オンライン" : "オフライン"}</span>
            </span>
            <span className="w-14 shrink-0 text-right text-sm">{p.bingoAtSeq !== null ? `${p.bingoAtSeq}回目` : ""}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`${p.nickname} の操作`}>
                  ⋯
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={async () => {
                    const code = await props.onShowCode(p);
                    if (code) setDialog({ kind: "code", p, code });
                  }}
                >
                  参加コードを表示
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!props.canEdit} onSelect={() => setDialog({ kind: "confirm-replace", p })}>
                  コードを差し替える
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!props.canEdit}
                  variant="destructive"
                  onSelect={() => setDialog({ kind: "confirm-remove", p })}
                >
                  削除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
        {rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">参加者はいません</li>}
      </ul>
      <Button variant="outline" onClick={props.onExport}>
        CSV を書き出す
      </Button>

      {/* 参加コードの表示（この画面の中でだけ大きく出す。F-09） */}
      <AlertDialog open={dialog?.kind === "code"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          {dialog?.kind === "code" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {dialog.p.nickname} さんの{dialog.replaced ? "新しい" : ""}参加コード
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {dialog.replaced ? "前のコードはもう使えません。本人に伝えてください。" : "本人か確かめてから伝えてください。"}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <p className="py-4 text-center font-mono text-5xl font-black tracking-widest">{formatJoinCode(dialog.code)}</p>
              <AlertDialogFooter>
                <AlertDialogCancel>閉じる</AlertDialogCancel>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog?.kind === "confirm-replace"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          {dialog?.kind === "confirm-replace" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dialog.p.nickname} さんのコードを差し替えますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  今のコードは使えなくなり、そのコードで開いている端末は切断されます。カードと結果はそのままです。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel autoFocus>いいえ</AlertDialogCancel>
                <Button
                  onClick={async () => {
                    const p = dialog.p;
                    const code = await props.onReplaceCode(p);
                    setDialog(code ? { kind: "code", p, code, replaced: true } : null);
                  }}
                >
                  差し替える
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dialog?.kind === "confirm-remove"} onOpenChange={(o) => !o && setDialog(null)}>
        <AlertDialogContent>
          {dialog?.kind === "confirm-remove" && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dialog.p.nickname} さんを削除しますか？</AlertDialogTitle>
                <AlertDialogDescription>
                  この人のカード・リーチ・ビンゴの記録が消え、その参加コードは使えなくなります。順位は付け直しません。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel autoFocus>いいえ</AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    const p = dialog.p;
                    setDialog(null);
                    await props.onRemove(p);
                  }}
                >
                  削除する
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
