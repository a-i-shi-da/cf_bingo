import type { RandomInt } from "../../src/lib/random";

/** 結果を固定できる乱数（mulberry32）。テスト専用 */
export function seededRandom(seed: number): RandomInt {
  let a = seed >>> 0;
  return (maxExclusive) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const x = ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
    return Math.floor(x * maxExclusive);
  };
}
