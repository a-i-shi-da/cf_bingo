// エラーコードを画面に出す文に直す（docs/design/api.md 6章）
import type { ErrorCode } from "../agents/types";

const MESSAGES: Partial<Record<ErrorCode, string>> = {
  BAD_TOKEN: "この司会用 URL は使えません",
  RATE_LIMITED: "しばらくしてからもう一度お試しください",
  CODE_USED: "使用済みのコードは「差し替え」を使ってください",
  FORBIDDEN: "操作する権限がありません",
  BAD_PASSPHRASE: "合言葉が違います",
  CODE_INVALID: "このコードは使えません",
  CODE_REVOKED: "このコードは使えません。受付にお問い合わせください",
  NICKNAME_TAKEN: "このニックネームはすでに使われています",
  NICKNAME_INVALID: "ニックネームは1〜20文字で入力してください",
  NAME_INVALID: "ルーム名は1〜40文字で入力してください",
  NAME_MISMATCH: "ルーム名が一致しません",
  ROOM_FULL: "定員に達しました",
  ROOM_FINISHED: "このゲームは終了しました",
  LATE_JOIN_CLOSED: "途中参加の受付は終了しました",
  ROOM_PLAYING: "ゲーム中のルームは削除できません",
  ROOM_NOT_FOUND: "このルームは見つかりません",
  NO_NUMBERS_LEFT: "すべての番号を引きました",
  CODE_LIMIT: "これ以上発行できません（上限150枚）",
  NOT_FOUND: "参加者が見つかりません",
};

export function errorMessage(code: ErrorCode | string | undefined): string {
  return (code && MESSAGES[code as ErrorCode]) || "うまくいきませんでした。もう一度お試しください";
}
