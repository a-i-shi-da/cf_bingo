// ルーム ID・司会トークン・参加者 ID（docs/design/security.md 2章）
import { cryptoRandomInt, randomString, type RandomInt } from "./random";

const LOWER_ALNUM = "abcdefghijklmnopqrstuvwxyz0123456789";
const URL_SAFE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** ルーム ID：URL に使う12文字（秘密ではないが推測されにくくする） */
export function generateRoomId(rand: RandomInt = cryptoRandomInt): string {
  return randomString(LOWER_ALNUM, 12, rand);
}

/** 司会トークン：256ビット（URL で使える64種の文字 × 43文字 = 258ビット） */
export function generateHostToken(rand: RandomInt = cryptoRandomInt): string {
  return randomString(URL_SAFE, 43, rand);
}

/** 参加者 ID：画面には出さない内部の ID */
export function generateParticipantId(rand: RandomInt = cryptoRandomInt): string {
  return randomString(LOWER_ALNUM, 16, rand);
}
