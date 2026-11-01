// 入力チェック（docs/design/domain-model.md 8章、docs/design/security.md 5章）

export const NICKNAME_MAX = 20;
export const ROOM_NAME_MAX = 40;

// 制御文字（C0・DEL・C1）と、文字の向きを変える書式文字（表示を偽装できるため）
const CONTROL_CHARS = /[\p{Cc}‎‏‪-‮⁦-⁩]/gu;

/** 制御文字を取り除き、前後の空白を除く */
export function sanitizeText(input: string): string {
  return input.normalize("NFC").replace(CONTROL_CHARS, "").trim();
}

export type TextCheck = { ok: true; value: string } | { ok: false };

/** 1〜max 文字か確かめる（文字数はコードポイントで数える） */
function checkLength(input: unknown, max: number): TextCheck {
  if (typeof input !== "string") return { ok: false };
  const value = sanitizeText(input);
  const len = [...value].length;
  return len >= 1 && len <= max ? { ok: true, value } : { ok: false };
}

/** ニックネーム：1〜20文字 */
export function checkNickname(input: unknown): TextCheck {
  return checkLength(input, NICKNAME_MAX);
}

/** ルーム名：1〜40文字 */
export function checkRoomName(input: unknown): TextCheck {
  return checkLength(input, ROOM_NAME_MAX);
}
