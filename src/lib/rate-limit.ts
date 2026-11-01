// 試行回数の制限（docs/design/security.md 2-2）。失敗した時刻の並びだけで判断する純粋関数

export type RateRule = { max: number; windowMs: number };

/** 参加コード（join・resume）：1つの接続で、間違いが1分間に5回まで */
export const JOIN_PER_CONNECTION: RateRule = { max: 5, windowMs: 60_000 };
/** 参加コード（join・resume）：1ルーム全体で、間違いが10分間に100回まで */
export const JOIN_PER_ROOM: RateRule = { max: 100, windowMs: 10 * 60_000 };
/** 司会トークン（authHost）：1つの接続で、間違いが1分間に5回まで */
export const HOST_PER_CONNECTION: RateRule = { max: 5, windowMs: 60_000 };

/** 期間内の失敗だけを残す */
export function recentFailures(times: readonly number[], now: number, rule: RateRule): number[] {
  return times.filter((t) => now - t < rule.windowMs);
}

/** 期間内の失敗が上限に達していたら true（それ以上は受け付けない） */
export function isRateLimited(times: readonly number[], now: number, rule: RateRule): boolean {
  return recentFailures(times, now, rule).length >= rule.max;
}

/** 失敗を1回記録した新しい並び（古いものは捨てる） */
export function recordFailure(times: readonly number[], now: number, rule: RateRule): number[] {
  return [...recentFailures(times, now, rule), now];
}

/** 合言葉（管理画面）：同じ接続元から、間違いが10分間に5回まで。超えたら10分間受け付けない */
export const PASSPHRASE_PER_SOURCE: RateRule = { max: 5, windowMs: 10 * 60_000 };
export const PASSPHRASE_LOCK_MS = 10 * 60_000;

export type Lockout = { failures: readonly number[]; lockedUntil: number };

/** 締め出し中か */
export function isLockedOut(entry: Lockout | undefined, now: number): boolean {
  return entry !== undefined && now < entry.lockedUntil;
}

/** 失敗を1回記録する。期間内の失敗が上限に達したら、lockMs のあいだ締め出す */
export function recordLockoutFailure(
  entry: Lockout | undefined,
  now: number,
  rule: RateRule,
  lockMs: number,
): Lockout {
  const failures = recordFailure(entry?.failures ?? [], now, rule);
  if (failures.length >= rule.max) return { failures: [], lockedUntil: now + lockMs };
  return { failures, lockedUntil: entry?.lockedUntil ?? 0 };
}
