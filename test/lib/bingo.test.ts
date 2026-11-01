import { describe, expect, it } from "vitest";
import {
  COLUMN_RANGES,
  FREE,
  LINES,
  drawNumber,
  evaluateCard,
  generateCard,
  generateLateJoinCard,
  isBingo,
  isLateJoinClosed,
  judgeAll,
  markedCells,
  type Card,
  type PlayerRecord,
} from "../../src/lib/bingo";
import { cryptoRandomInt } from "../../src/lib/random";
import { seededRandom } from "../helpers/seeded-random";

// 列 B:1-5 / I:16-20 / N:31,32,FREE,33,34 / G:46-50 / O:61-65
const CARD: Card = [
  [1, 16, 31, 46, 61],
  [2, 17, 32, 47, 62],
  [3, 18, FREE, 48, 63],
  [4, 19, 33, 49, 64],
  [5, 20, 34, 50, 65],
];

function drawAll(rand = cryptoRandomInt): number[] {
  const drawn: number[] = [];
  for (;;) {
    const n = drawNumber(drawn, rand);
    if (n === null) return drawn;
    drawn.push(n);
  }
}

describe("カード生成（game-rules 1章）", () => {
  it.each(Array.from({ length: 50 }, (_, i) => i))("列の範囲・重なりなし・中央 FREE（seed %i）", (seed) => {
    const card = generateCard(seededRandom(seed));
    expect(card).toHaveLength(5);
    for (const row of card) expect(row).toHaveLength(5);
    expect(card[2][2]).toBe(FREE);

    COLUMN_RANGES.forEach(([lo, hi], c) => {
      const nums = card.map((row) => row[c]).filter((n) => n !== FREE);
      expect(nums).toHaveLength(c === 2 ? 4 : 5);
      expect(new Set(nums).size).toBe(nums.length);
      for (const n of nums) {
        expect(n).toBeGreaterThanOrEqual(lo);
        expect(n).toBeLessThanOrEqual(hi);
      }
    });
  });

  it("FREE は中央にしかない", () => {
    const card = generateCard();
    const frees = card.flat().filter((n) => n === FREE);
    expect(frees).toHaveLength(1);
  });

  it("同じ乱数なら同じカード、違う乱数なら違うカード", () => {
    expect(generateCard(seededRandom(1))).toEqual(generateCard(seededRandom(1)));
    expect(generateCard(seededRandom(1))).not.toEqual(generateCard(seededRandom(2)));
  });
});

describe("抽選（game-rules 2章）", () => {
  it("同じ番号が出ず、75回で1〜75を引き切る", () => {
    const drawn = drawAll(seededRandom(42));
    expect(drawn).toHaveLength(75);
    expect([...drawn].sort((a, b) => a - b)).toEqual(Array.from({ length: 75 }, (_, i) => i + 1));
  });

  it("76回目は引けない（null）", () => {
    const drawn = drawAll();
    expect(drawNumber(drawn)).toBeNull();
  });

  it("引いていない番号からだけ選ぶ", () => {
    const drawn = Array.from({ length: 74 }, (_, i) => i + 1); // 75 だけ残す
    for (let seed = 0; seed < 10; seed++) expect(drawNumber(drawn, seededRandom(seed))).toBe(75);
  });

  it("暗号論的な乱数でも引き切れる", () => {
    expect(new Set(drawAll()).size).toBe(75);
  });
});

describe("マーク（game-rules 3章）", () => {
  it("FREE は最初からマーク済み、引いた番号だけマークされる", () => {
    const marked = markedCells(CARD, [1, 48, 70]);
    expect(marked[2][2]).toBe(true);
    expect(marked[0][0]).toBe(true);
    expect(marked[2][3]).toBe(true);
    expect(marked.flat().filter(Boolean)).toHaveLength(3);
  });
});

describe("ライン判定（game-rules 4章）", () => {
  it("ラインは12本（横5・縦5・斜め2）", () => {
    expect(LINES).toHaveLength(12);
    const keys = new Set(LINES.map((l) => l.map(([r, c]) => `${r},${c}`).sort().join("|")));
    expect(keys.size).toBe(12);
  });

  it("何も引いていなければ揃わない", () => {
    expect(evaluateCard(CARD, [])).toEqual({ completedLines: 0, almostLines: 0 });
  });

  it.each([
    ["横（1行目）", [1, 16, 31, 46, 61]],
    ["横（中央の行。FREE を含む）", [3, 18, 48, 63]],
    ["縦（B列）", [1, 2, 3, 4, 5]],
    ["縦（N列。FREE を含む）", [31, 32, 33, 34]],
    ["斜め（左上→右下）", [1, 17, 49, 65]],
    ["斜め（右上→左下）", [61, 47, 19, 5]],
  ])("%s が揃う", (_label, drawn) => {
    expect(evaluateCard(CARD, drawn).completedLines).toBe(1);
    expect(isBingo(CARD, drawn)).toBe(true);
  });

  it("4マスだけでは揃わない（FREE を通らないライン）", () => {
    expect(isBingo(CARD, [1, 2, 3, 4])).toBe(false);
  });

  it("複数のラインが同時に揃うと、その本数を数える", () => {
    // 1行目と B列が両方揃う
    expect(evaluateCard(CARD, [1, 16, 31, 46, 61, 2, 3, 4, 5]).completedLines).toBe(2);
  });
});

describe("リーチ（game-rules 5章）", () => {
  it("あと1マスのライン数を数える", () => {
    // 中央の行は FREE＋3 / 縦N列は FREE＋1 / 斜めは FREE だけ
    expect(evaluateCard(CARD, [3, 18, 48]).almostLines).toBe(1);
  });

  it("1つの番号で複数のラインがリーチになる（ダブルリーチ）", () => {
    // 1 を除いた 1行目 と、1 を除いた B列 → どちらも 1 待ち
    const st = evaluateCard(CARD, [16, 31, 46, 61, 2, 3, 4, 5]);
    expect(st).toEqual({ completedLines: 0, almostLines: 2 });
  });

  it("FREE を通るラインは3つ引けばリーチ", () => {
    // 斜め（左上→右下）：1, 17, FREE, 49 → 65 待ち
    expect(evaluateCard(CARD, [1, 17, 49]).almostLines).toBe(1);
  });
});

describe("ビンゴと順位（game-rules 6章・8章）", () => {
  const players = (cards: Record<string, Card>, done: Partial<Record<string, [number, number]>> = {}): PlayerRecord[] =>
    Object.entries(cards).map(([id, card]) => ({
      id,
      card,
      bingoAtSeq: done[id]?.[0] ?? null,
      bingoRank: done[id]?.[1] ?? null,
    }));

  // CARD の B列を 6-10 に替えたカード（B 1-5 では揃わず、O列 61-65 で揃う）
  const CARD_O: Card = CARD.map((row, r) => [6 + r, ...row.slice(1)]);
  const B = [1, 2, 3, 4, 5];

  it("ビンゴした回と順位を記録し、リーチには数えない", () => {
    const drawn = [70, ...B]; // 6回目で B列が揃う
    const { results, winnerCount } = judgeAll(players({ a: CARD }), drawn, 0);
    expect(results[0]).toEqual({
      id: "a",
      reachLines: 0,
      completedLines: 1,
      bingoAtSeq: 6,
      bingoRank: 1,
      newlyBingo: true,
    });
    expect(winnerCount).toBe(1);
  });

  it("同じ抽選回でビンゴした人は同着、次の順位は人数分下がる", () => {
    const cards = { a: CARD, b: CARD, c: CARD_O };
    // 5回目で a・b が同時にビンゴ
    const first = judgeAll(players(cards), B, 0);
    expect(first.results.map((r) => r.bingoRank)).toEqual([1, 1, null]);
    expect(first.winnerCount).toBe(2);

    // c は O列（61-65）で、10回目にビンゴ → 3位
    const drawn = [...B, 61, 62, 63, 64, 65];
    const second = judgeAll(
      players(cards, { a: [5, 1], b: [5, 1] }),
      drawn,
      first.winnerCount,
    );
    expect(second.results.find((r) => r.id === "c")).toMatchObject({ bingoAtSeq: 10, bingoRank: 3, newlyBingo: true });
    expect(second.winnerCount).toBe(3);
  });

  it("ビンゴ済みの人は記録が変わらず、2本目以降は揃ったライン数だけ増える", () => {
    const drawn = [...B, 16, 31, 46, 61]; // 1行目も揃う
    const { results, winnerCount } = judgeAll(players({ a: CARD }, { a: [5, 1] }), drawn, 1);
    expect(results[0]).toEqual({
      id: "a",
      reachLines: 0,
      completedLines: 2,
      bingoAtSeq: 5,
      bingoRank: 1,
      newlyBingo: false,
    });
    expect(winnerCount).toBe(1);
  });

  it("ビンゴしていない人はリーチ数を返す", () => {
    const { results } = judgeAll(players({ a: CARD }), [1, 2, 3, 4], 0);
    expect(results[0]).toMatchObject({ reachLines: 1, completedLines: 0, bingoAtSeq: null, bingoRank: null });
  });

  it("削除された人の分も含めた人数を渡せば、順位は付け直さない", () => {
    // 1位の人（2人）が削除されて一覧にいなくても、次は3位
    const { results } = judgeAll(players({ c: CARD }), B, 2);
    expect(results[0].bingoRank).toBe(3);
  });
});

describe("途中参加のカード（game-rules 7章）", () => {
  it.each([0, 10, 20, 30, 40, 50, 55])("%i 回引いたあとでも、ビンゴになっていないカードを配る", (n) => {
    for (let seed = 0; seed < 30; seed++) {
      const rand = seededRandom(seed * 100 + n);
      const drawn = drawAll(rand).slice(0, n);
      const card = generateLateJoinCard(drawn, rand);
      // 作れないのは、途中参加の受付が終わったときだけ
      expect(card === null).toBe(isLateJoinClosed(drawn));
      if (card === null) continue;
      expect(isBingo(card, drawn)).toBe(false);
    }
  });

  it("普通に作れなくても、未抽選の番号を各ラインに置いて作る（tries = 0）", () => {
    for (let seed = 0; seed < 100; seed++) {
      const rand = seededRandom(seed);
      const drawn = drawAll(rand).slice(0, 60);
      const card = generateLateJoinCard(drawn, rand, 0);
      expect(card === null).toBe(isLateJoinClosed(drawn));
      if (card === null) continue;
      expect(isBingo(card, drawn)).toBe(false);
      // カードの形も守られている
      COLUMN_RANGES.forEach(([lo, hi], c) => {
        const nums = card.map((row) => row[c]).filter((x) => x !== FREE);
        expect(new Set(nums).size).toBe(c === 2 ? 4 : 5);
        expect(nums.every((x) => x >= lo && x <= hi)).toBe(true);
      });
      expect(card[2][2]).toBe(FREE);
    }
  });

  it("リーチの状態で配るのはかまわない", () => {
    // 各列に1つずつだけ未抽選の番号が残っている（ほぼすべてのラインがリーチになる）
    const left = new Set([1, 16, 31, 46, 61]);
    const drawn = Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => !left.has(n));
    const card = generateLateJoinCard(drawn, seededRandom(1), 0);
    expect(card).not.toBeNull();
    const st = evaluateCard(card!, drawn);
    expect(st.completedLines).toBe(0);
    expect(st.almostLines).toBeGreaterThan(0);
  });

  it("どこかの列の番号がすべて引かれたら、途中参加の受付は終わり", () => {
    expect(isLateJoinClosed([])).toBe(false);
    expect(isLateJoinClosed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])).toBe(false);
    expect(isLateJoinClosed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])).toBe(true);
    // N列（31-45）は FREE があっても15個すべて引かれたら終わり
    expect(isLateJoinClosed(Array.from({ length: 15 }, (_, i) => 31 + i))).toBe(true);
    // 各列に1つずつ残っていれば、まだ受け付ける
    expect(isLateJoinClosed(Array.from({ length: 75 }, (_, i) => i + 1).filter((n) => ![1, 16, 31, 46, 61].includes(n)))).toBe(false);
  });

  it("途中参加の受付が終わっていたら、作れないので null", () => {
    const drawn = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]; // B列を引き切った
    expect(generateLateJoinCard(drawn, seededRandom(1), 0)).toBeNull();
    expect(generateLateJoinCard(drawAll(), seededRandom(1))).toBeNull();
  });
});
