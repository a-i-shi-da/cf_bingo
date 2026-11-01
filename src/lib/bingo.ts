// ビンゴのゲームロジック（docs/product/game-rules.md）。純粋関数だけを置く。
import { cryptoRandomInt, shuffle, type RandomInt } from "./random";

export const SIZE = 5;
export const MAX_NUMBER = 75;
/** カードの中央（FREE）を表す値 */
export const FREE = 0;
const CENTER = 2;

/** 列ごとの番号の範囲（B1-15 / I16-30 / N31-45 / G46-60 / O61-75） */
export const COLUMN_RANGES: readonly (readonly [number, number])[] = [
  [1, 15],
  [16, 30],
  [31, 45],
  [46, 60],
  [61, 75],
];

/** 5×5 のカード。cells[行][列]。中央は FREE（0） */
export type Card = number[][];

type Pos = readonly [row: number, col: number];

/** 判定する12本のライン：横5・縦5・斜め2（game-rules 4章） */
export const LINES: readonly (readonly Pos[])[] = (() => {
  const idx = [0, 1, 2, 3, 4];
  return [
    ...idx.map((r) => idx.map((c) => [r, c] as const)),
    ...idx.map((c) => idx.map((r) => [r, c] as const)),
    idx.map((i) => [i, i] as const),
    idx.map((i) => [i, SIZE - 1 - i] as const),
  ];
})();

function range(lo: number, hi: number): number[] {
  return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
}

/** 列ごとの番号（行の順）から Card を組み立てる。中央は FREE にする */
function fromColumns(columns: number[][]): Card {
  return range(0, SIZE - 1).map((r) =>
    range(0, SIZE - 1).map((c) => (r === CENTER && c === CENTER ? FREE : columns[c][r])),
  );
}

/** カードを作る（game-rules 1章）。列ごとに範囲から重なりのない番号を選ぶ */
export function generateCard(rand: RandomInt = cryptoRandomInt): Card {
  const columns = COLUMN_RANGES.map(([lo, hi]) => shuffle(range(lo, hi), rand).slice(0, SIZE));
  return fromColumns(columns);
}

/** まだ引いていない番号から1つ選ぶ。75個引き切っていたら null（game-rules 2章） */
export function drawNumber(drawn: readonly number[], rand: RandomInt = cryptoRandomInt): number | null {
  const used = new Set(drawn);
  const left = range(1, MAX_NUMBER).filter((n) => !used.has(n));
  if (left.length === 0) return null;
  return left[rand(left.length)];
}

/** マーク済みのマス（FREE はマーク済み）。マークは保存せず、引いた番号から計算する */
export function markedCells(card: Card, drawn: Iterable<number>): boolean[][] {
  const set = new Set(drawn);
  return card.map((row) => row.map((n) => n === FREE || set.has(n)));
}

export type CardStatus = {
  /** 揃ったライン数 */
  completedLines: number;
  /** あと1マスで揃うライン数（ビンゴ済みかどうかは考えない） */
  almostLines: number;
};

/** カードのライン状況を数える（game-rules 4・5章） */
export function evaluateCard(card: Card, drawn: Iterable<number>): CardStatus {
  const marked = markedCells(card, drawn);
  let completedLines = 0;
  let almostLines = 0;
  for (const line of LINES) {
    const open = line.filter(([r, c]) => !marked[r][c]).length;
    if (open === 0) completedLines++;
    else if (open === 1) almostLines++;
  }
  return { completedLines, almostLines };
}

export function isBingo(card: Card, drawn: Iterable<number>): boolean {
  return evaluateCard(card, drawn).completedLines > 0;
}

export type PlayerRecord = {
  id: string;
  card: Card;
  /** 何回目の抽選でビンゴしたか（まだなら null） */
  bingoAtSeq: number | null;
  bingoRank: number | null;
};

export type PlayerJudgement = {
  id: string;
  /** リーチのライン数。ビンゴ済みの人は 0（game-rules 5章） */
  reachLines: number;
  /** 揃ったライン数（2本目以降の表示に使う。当選には数えない） */
  completedLines: number;
  bingoAtSeq: number | null;
  bingoRank: number | null;
  /** この抽選で新しくビンゴになったか */
  newlyBingo: boolean;
};

/**
 * 抽選のあとに、全員（接続していない人も含む）のリーチ・ビンゴを判定する（game-rules 5・6章）。
 *
 * - 新しくビンゴになった人は、bingoAtSeq = drawn.length、順位は全員 priorWinnerCount + 1（同着）
 * - すでにビンゴ済みの人の記録は変えない（景品は1人1回）
 * - priorWinnerCount は、これまでにビンゴした人数。削除された人も含める
 *   （削除しても順位は付け直さないため。game-rules 8章）
 */
export function judgeAll(
  players: readonly PlayerRecord[],
  drawn: readonly number[],
  priorWinnerCount: number,
): { results: PlayerJudgement[]; winnerCount: number } {
  const seq = drawn.length;
  const rank = priorWinnerCount + 1;
  let newWinners = 0;
  const results = players.map((p): PlayerJudgement => {
    const { completedLines, almostLines } = evaluateCard(p.card, drawn);
    if (p.bingoAtSeq !== null) {
      return { id: p.id, reachLines: 0, completedLines, bingoAtSeq: p.bingoAtSeq, bingoRank: p.bingoRank, newlyBingo: false };
    }
    if (completedLines > 0) {
      newWinners++;
      return { id: p.id, reachLines: 0, completedLines, bingoAtSeq: seq, bingoRank: rank, newlyBingo: true };
    }
    return { id: p.id, reachLines: almostLines, completedLines, bingoAtSeq: null, bingoRank: null, newlyBingo: false };
  });
  return { results, winnerCount: priorWinnerCount + newWinners };
}

/**
 * 1行に1つずつ、どの列にも1つずつ置くと、12本すべてのラインにかかる置き方（中央は除く）。
 * 置き方 p は「r 行目の p[r] 列」を表す。
 */
const BLOCKING_PERMUTATIONS: readonly number[][] = (() => {
  const result: number[][] = [];
  const permute = (rest: number[], acc: number[]) => {
    if (rest.length === 0) {
      const centerFree = acc[CENTER] !== CENTER;
      const main = acc.some((c, r) => c === r);
      const anti = acc.some((c, r) => c === SIZE - 1 - r);
      if (centerFree && main && anti) result.push(acc);
      return;
    }
    rest.forEach((c, i) => permute([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, c]));
  };
  permute(range(0, SIZE - 1), []);
  return result;
})();

/**
 * 途中参加の人のカードを作る（game-rules 7章）。参加した時点でビンゴになっていないカードを返す。
 *
 * まず普通に作ってビンゴでないものを探し（tries 回まで）、見つからなければ、
 * 各ラインに「まだ引いていない番号」を1つずつ置いて作る。
 * どこかの列の番号がすべて引かれていると、どう作ってもビンゴになるので null を返す。
 */
export function generateLateJoinCard(
  drawn: readonly number[],
  rand: RandomInt = cryptoRandomInt,
  tries = 100,
): Card | null {
  for (let i = 0; i < tries; i++) {
    const card = generateCard(rand);
    if (!isBingo(card, drawn)) return card;
  }

  const used = new Set(drawn);
  const undrawnByColumn = COLUMN_RANGES.map(([lo, hi]) => range(lo, hi).filter((n) => !used.has(n)));
  if (undrawnByColumn.some((list) => list.length === 0)) return null;

  const perm = BLOCKING_PERMUTATIONS[rand(BLOCKING_PERMUTATIONS.length)];
  const columns = COLUMN_RANGES.map(([lo, hi], c) => {
    const row = perm.indexOf(c);
    const blocker = undrawnByColumn[c][rand(undrawnByColumn[c].length)];
    const others = shuffle(range(lo, hi).filter((n) => n !== blocker), rand).slice(0, SIZE - 1);
    others.splice(row, 0, blocker);
    return others;
  });
  return fromColumns(columns);
}
