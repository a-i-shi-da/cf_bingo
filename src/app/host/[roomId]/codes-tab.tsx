"use client";

// S-02 参加コードタブ（docs/design/screens.md 4-3。F-02・F-03・F-11）
import Link from "next/link";
import { useState } from "react";
import type { CodeCounts, CodeEntry } from "@/agents/types";
import { formatJoinCode } from "@/lib/join-code";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const STATUS_LABEL = { unused: "未使用", used: "使用済み", revoked: "無効" } as const;

type Props = {
  roomId: string;
  counts: CodeCounts | null;
  codes: CodeEntry[] | null;
  canIssue: boolean;
  busy: boolean;
  onIssue: (count: number) => void;
  onRevoke: (code: string) => void;
};

export function CodesTab(props: Props) {
  const [count, setCount] = useState("10");
  const n = Number(count);
  const valid = Number.isInteger(n) && n >= 1 && n <= 150;

  return (
    <div className="space-y-4">
      {props.counts && (
        <p className="text-sm">
          発行済み <strong>{props.counts.issued}</strong>枚（使用済み {props.counts.used}・未使用 {props.counts.unused}・無効{" "}
          {props.counts.revoked}）／ 上限150枚
        </p>
      )}

      {props.canIssue && (
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) props.onIssue(n);
          }}
        >
          <Input
            type="number"
            min={1}
            max={150}
            className="w-24"
            value={count}
            onChange={(e) => setCount(e.target.value)}
            aria-label="追加で発行する枚数"
          />
          <Button type="submit" disabled={!valid || props.busy}>
            枚 追加で発行
          </Button>
        </form>
      )}

      <Button variant="outline" asChild>
        {/* 司会トークンはタブの中だけに保存しているので、同じタブで開く */}
        <Link href={`/host/${props.roomId}/print`}>印刷ページを開く</Link>
      </Button>

      <ul className="divide-y rounded-lg border">
        {props.codes === null && <li className="p-3 text-sm text-muted-foreground">読み込んでいます…</li>}
        {props.codes?.length === 0 && <li className="p-3 text-sm text-muted-foreground">まだ発行していません</li>}
        {props.codes?.map((c) => (
          <li key={c.code} className="flex items-center gap-3 p-2">
            <span className="font-mono text-lg tracking-widest">{formatJoinCode(c.code)}</span>
            <Badge variant={c.status === "unused" ? "secondary" : "default"}>{STATUS_LABEL[c.status]}</Badge>
            {c.status === "unused" && props.canIssue && (
              // 紛失した未使用のコードが使われないように無効にする（F-11）
              <Button variant="ghost" size="sm" className="ml-auto" disabled={props.busy} onClick={() => props.onRevoke(c.code)}>
                無効にする
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
