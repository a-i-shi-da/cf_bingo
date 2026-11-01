// 乱数（docs/product/game-rules.md 2章：暗号論的な乱数を使う）
// 乱数を使う関数は RandomInt を引数で受け取り、テストでは結果を固定できるようにする。

/** 0 以上 maxExclusive 未満の整数を返す */
export type RandomInt = (maxExclusive: number) => number;

const UINT32_RANGE = 0x1_0000_0000;

/** crypto.getRandomValues を使う RandomInt（偏りが出ないよう、端数を捨ててやり直す） */
export const cryptoRandomInt: RandomInt = (maxExclusive) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new RangeError(`maxExclusive が不正です: ${maxExclusive}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % maxExclusive;
  }
};

/** 配列をシャッフルした新しい配列を返す（Fisher–Yates） */
export function shuffle<T>(items: readonly T[], rand: RandomInt = cryptoRandomInt): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** alphabet の文字からランダムに length 文字を選んだ文字列 */
export function randomString(
  alphabet: string,
  length: number,
  rand: RandomInt = cryptoRandomInt,
): string {
  let s = "";
  for (let i = 0; i < length; i++) s += alphabet[rand(alphabet.length)];
  return s;
}
