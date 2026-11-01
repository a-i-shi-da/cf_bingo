import { describe, expect, it } from "vitest";
import { JOIN_PER_CONNECTION, isRateLimited, recordFailure, recentFailures } from "../../src/lib/rate-limit";
import { buildResultsCsv, compareParticipants, formatJst, type ResultRow } from "../../src/lib/results";
import { secureEqual } from "../../src/lib/secure-compare";
import { nicknameKey } from "../../src/lib/validate";

describe("試行回数の制限（security 2-2）", () => {
  it("期間内の失敗が上限に達したら制限し、期間を過ぎたら戻る", () => {
    let times: number[] = [];
    for (let i = 0; i < 4; i++) times = recordFailure(times, 1000 + i, JOIN_PER_CONNECTION);
    expect(isRateLimited(times, 2000, JOIN_PER_CONNECTION)).toBe(false);
    times = recordFailure(times, 2000, JOIN_PER_CONNECTION);
    expect(isRateLimited(times, 2000, JOIN_PER_CONNECTION)).toBe(true);
    // 最初の失敗（1000）から1分たつと、それが外れて4回になる
    expect(isRateLimited(times, 1000 + 60_000, JOIN_PER_CONNECTION)).toBe(false);
  });

  it("古い失敗は捨てる", () => {
    expect(recentFailures([0, 30_000, 59_999], 60_000, JOIN_PER_CONNECTION)).toEqual([30_000, 59_999]);
    expect(recordFailure([0], 60_000, JOIN_PER_CONNECTION)).toEqual([60_000]);
  });
});

describe("秘密の値の比較", () => {
  it("同じなら true、違えば false（長さが違っても）", () => {
    expect(secureEqual("abc", "abc")).toBe(true);
    expect(secureEqual("abc", "abd")).toBe(false);
    expect(secureEqual("abc", "abcd")).toBe(false);
    expect(secureEqual("", "")).toBe(true);
    expect(secureEqual("合言葉", "合言葉")).toBe(true);
  });
});

describe("ニックネームの比較", () => {
  it("全角・半角と大文字・小文字の違いは同じとみなす。ひらがなとカタカナは別", () => {
    expect(nicknameKey("Taro")).toBe(nicknameKey("ｔａｒｏ"));
    expect(nicknameKey("たろう")).not.toBe(nicknameKey("タロウ"));
  });
});

describe("結果の並びと CSV（F-07・F-10）", () => {
  const row = (nickname: string, o: Partial<ResultRow> = {}): ResultRow => ({
    nickname,
    joinedAt: 0,
    joinedAtSeq: 0,
    reachLines: 0,
    completedLines: 0,
    bingoAtSeq: null,
    bingoRank: null,
    ...o,
  });

  it("ビンゴ（順位順）→ リーチ（本数の多い順）→ 参加順", () => {
    const rows = [
      row("参加2", { joinedAt: 2 }),
      row("リーチ1", { reachLines: 1 }),
      row("3位", { bingoRank: 3 }),
      row("参加1", { joinedAt: 1 }),
      row("リーチ2", { reachLines: 2 }),
      row("1位", { bingoRank: 1 }),
    ];
    expect([...rows].sort(compareParticipants).map((r) => r.nickname)).toEqual([
      "1位",
      "3位",
      "リーチ2",
      "リーチ1",
      "参加1",
      "参加2",
    ]);
  });

  it("日時は日本時間", () => {
    expect(formatJst(Date.UTC(2026, 11, 15, 10, 3, 0))).toBe("2026-12-15 19:03:00");
  });

  it("CSV は見出し＋並べた行。BOM 付き", () => {
    const csv = buildResultsCsv([row("b", { joinedAt: Date.UTC(2026, 0, 1), joinedAtSeq: 3 }), row("a", { bingoRank: 1, bingoAtSeq: 9, completedLines: 1 })]);
    expect(csv.split("\r\n")).toEqual([
      "﻿順位,ニックネーム,ビンゴした抽選回,リーチ数,揃ったライン数,参加した日時,参加時の抽選回数",
      "1,a,9,0,1,1970-01-01 09:00:00,0",
      ",b,,0,0,2026-01-01 09:00:00,3",
      "",
    ]);
  });
});
