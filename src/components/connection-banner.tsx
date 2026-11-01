"use client";

// 接続状態の帯（docs/design/screens.md 2章）：切れてから数秒たっても戻らなければ、上部に「再接続中…」を出す
import { useEffect, useState } from "react";

/** 切れている間だけ置く。置かれてから delayMs たったら帯を出す（つながったら外されるので、次に切れたときは数え直す） */
function DelayedBanner({ delayMs }: { delayMs: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  if (!visible) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 bg-destructive py-2 text-center text-sm font-bold text-white">
      再接続中…
    </div>
  );
}

export function ConnectionBanner({ connected, delayMs = 3000 }: { connected: boolean; delayMs?: number }) {
  return connected ? null : <DelayedBanner delayMs={delayMs} />;
}
