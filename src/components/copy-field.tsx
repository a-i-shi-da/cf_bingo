"use client";

// URL などを表示してコピーする欄
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-sm font-bold">{label}</p>
      <div className="flex gap-2">
        <Input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
        <Button
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "コピーしました" : "コピー"}
        </Button>
      </div>
    </div>
  );
}

/** 文字列をファイルとしてダウンロードさせる（CSV の書き出し） */
export function downloadText(filename: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
