// 画面と Agent で共有する型（docs/design/api.md）
import type { Card } from "../lib/bingo";

export type RoomStatus = "waiting" | "playing" | "finished";

/** 公開 state：全クライアントに配る。秘密の値・カード・未当選者の名前を入れない（api.md 2章） */
export type RoomPublicState = {
  roomId: string;
  name: string;
  status: RoomStatus;
  drawn: number[];
  lastDrawnAt: number | null;
  participantCount: number;
  reachCount: number;
  winners: Winner[];
  startedAt: number | null;
  finishedAt: number | null;
  deleteAt: number | null;
};

export type Winner = { nickname: string; rank: number; atSeq: number };

/** 接続ごとの役割（api.md 1章） */
export type ConnectionRole = "guest" | "screen" | "player" | "host";

/**
 * 接続ごとの状態（connection.setState に保存。ハイバネーション後も残る）。
 * サーバーの中だけで使い、クライアントには送らない。
 */
export type ConnectionState = {
  role: ConnectionRole;
  /** player：参加者 ID と、名乗ったときのコード（差し替えで古いコードの接続を切るため） */
  participantId?: string;
  code?: string;
  /** host：名乗ったときの司会トークンの版（作り直したら古い版の接続を切る） */
  hostTokenVersion?: number;
  /** 間違えた時刻（試行回数の制限。security.md 2-2） */
  joinFailures?: readonly number[];
  hostFailures?: readonly number[];
};

/** エラーコード（api.md 6章） */
export type ErrorCode =
  | "BAD_TOKEN"
  | "RATE_LIMITED"
  | "CODE_USED"
  | "FORBIDDEN"
  | "BAD_PASSPHRASE"
  | "CODE_INVALID"
  | "CODE_REVOKED"
  | "CODE_UNUSED"
  | "NICKNAME_TAKEN"
  | "NICKNAME_INVALID"
  | "NAME_INVALID"
  | "NAME_MISMATCH"
  | "ROOM_FULL"
  | "ROOM_FINISHED"
  | "ROOM_PLAYING"
  | "ROOM_NOT_FOUND"
  | "ALREADY_INITIALIZED"
  | "LATE_JOIN_CLOSED"
  | "NOT_WAITING"
  | "NOT_PLAYING"
  | "COOLDOWN"
  | "NO_NUMBERS_LEFT"
  | "CODE_LIMIT"
  | "INVALID_ARGUMENT"
  | "NOT_FOUND";

export type Failure = { ok: false; error: ErrorCode };
export type Result<T extends object = object> = ({ ok: true } & T) | Failure;

/** 参加者本人の情報（`player:self` と join・resume の戻り値） */
export type PlayerSelf = {
  nickname: string;
  /** 名乗ったときだけ入る（それ以降は数字だけを送る。api.md 3章） */
  card?: Card;
  reachLines: number;
  completedLines: number;
  bingoRank: number | null;
  bingoAtSeq: number | null;
};

/** 司会に送る参加者の1行（`host:participants`） */
export type HostParticipant = {
  id: string;
  nickname: string;
  online: boolean;
  lastSeenAt: number;
  joinedAt: number;
  joinedAtSeq: number;
  reachLines: number;
  bingoRank: number | null;
  bingoAtSeq: number | null;
};

export type CodeStatus = "unused" | "used" | "revoked";

export type CodeCounts = { issued: number; used: number; unused: number; revoked: number };

export type CodeEntry = { code: string; status: CodeStatus; issuedAt: number };

/** サーバー → 画面の個別メッセージ（api.md 3章） */
export type ServerMessage =
  | ({ type: "player:self" } & PlayerSelf)
  | { type: "player:removed" }
  | { type: "player:code-replaced" }
  | { type: "host:token-changed" }
  | { type: "host:participants"; participants: HostParticipant[] }
  | ({ type: "host:codes" } & CodeCounts)
  | { type: "room:deleted" }
  | { type: "room:not-found" };

/** BingoRoom から RoomDirectory に知らせる内容（api.md 4-3） */
export type RoomChange = { status: RoomStatus; deleteAt: number | null };

/** ルーム一覧の1行（listRooms の戻り値。司会用 URL を含むので合言葉で守る） */
export type RoomEntry = {
  roomId: string;
  name: string;
  status: RoomStatus;
  createdAt: number;
  /** 削除予定日（終了後だけ入る） */
  deleteAt: number | null;
  hostUrl: string;
};
