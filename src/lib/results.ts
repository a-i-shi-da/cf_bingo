// 参加者の並び順と、結果の CSV（F-07・F-10。docs/design/screens.md 4-2）
import { toCsv } from "./csv";

export type ResultRow = {
  nickname: string;
  joinedAt: number;
  joinedAtSeq: number;
  reachLines: number;
  completedLines: number;
  bingoAtSeq: number | null;
  bingoRank: number | null;
};

/** 並び順：ビンゴ（順位順）→ リーチ（本数の多い順）→ そのほか（参加順） */
export function compareParticipants(a: ResultRow, b: ResultRow): number {
  const ra = a.bingoRank ?? Infinity;
  const rb = b.bingoRank ?? Infinity;
  if (ra !== rb) return ra - rb;
  if (a.reachLines !== b.reachLines) return b.reachLines - a.reachLines;
  return a.joinedAt - b.joinedAt;
}

/** 日本時間の「2026-12-15 19:03:00」 */
export function formatJst(ms: number): string {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
}

export const RESULT_CSV_HEADER = [
  "順位",
  "ニックネーム",
  "ビンゴした抽選回",
  "リーチ数",
  "揃ったライン数",
  "参加した日時",
  "参加時の抽選回数",
] as const;

/** 結果の CSV（BOM 付き）。参加コードは秘密の値なので入れない */
export function buildResultsCsv(rows: readonly ResultRow[]): string {
  const sorted = [...rows].sort(compareParticipants);
  return toCsv([
    [...RESULT_CSV_HEADER],
    ...sorted.map((r) => [
      r.bingoRank,
      r.nickname,
      r.bingoAtSeq,
      r.reachLines,
      r.completedLines,
      formatJst(r.joinedAt),
      r.joinedAtSeq,
    ]),
  ]);
}
