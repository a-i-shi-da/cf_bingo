// 参加コード（docs/design/security.md 2-1）
import { cryptoRandomInt, randomString, type RandomInt } from "./random";

/** 読み間違えやすい 0・O・1・I・L を除いた31文字 */
export const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const JOIN_CODE_LENGTH = 6;

const VALID = new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`);

/** 参加コードを1つ作る。existing にあるコードとは重ならない */
export function generateJoinCode(
  existing: ReadonlySet<string> = new Set(),
  rand: RandomInt = cryptoRandomInt,
): string {
  for (;;) {
    const code = randomString(JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, rand);
    if (!existing.has(code)) return code;
  }
}

/**
 * 入力された参加コードを保存の形（大文字6文字）にそろえる。形が合わなければ null。
 * 大文字・小文字を区別せず、ハイフン・空白はあってもなくてもよい。全角で入力されても受け付ける。
 */
export function normalizeJoinCode(input: string): string | null {
  const s = input
    .normalize("NFKC")
    .replace(/[\s\-‐‑‒–—―−ー]/g, "")
    .toUpperCase();
  return VALID.test(s) ? s : null;
}

/** 表示・印刷用に3文字ずつハイフンで区切る（例：K7P-3QX） */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}
