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
