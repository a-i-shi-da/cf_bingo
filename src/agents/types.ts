// 画面と Agent で共有する型（docs/design/api.md 2章）

/** 公開 state：全クライアントに配る。秘密の値・カード・未当選者の名前を入れない */
export type RoomPublicState = {
  roomId: string;
  name: string;
  status: "waiting" | "playing" | "finished";
  drawn: number[];
  lastDrawnAt: number | null;
  participantCount: number;
  reachCount: number;
  winners: { nickname: string; rank: number; atSeq: number }[];
  startedAt: number | null;
  finishedAt: number | null;
  deleteAt: number | null;
};

/** 接続ごとの役割（connection.setState に保存。ハイバネーション後も残る） */
export type ConnectionRole = "guest" | "screen" | "player" | "host";

export type ConnectionState = {
  role: ConnectionRole;
};
