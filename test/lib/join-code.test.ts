import { describe, expect, it } from "vitest";
import {
  JOIN_CODE_ALPHABET,
  formatJoinCode,
  generateJoinCode,
  normalizeJoinCode,
} from "../../src/lib/join-code";
import { generateHostToken, generateParticipantId, generateRoomId } from "../../src/lib/ids";
import { seededRandom } from "../helpers/seeded-random";

describe("参加コード（security 2-1）", () => {
  it("使う文字は31種類で、0・O・1・I・L を含まない", () => {
    expect(JOIN_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(JOIN_CODE_ALPHABET).size).toBe(31);
    for (const ch of "0O1IL") expect(JOIN_CODE_ALPHABET).not.toContain(ch);
  });

  it("6文字で、決められた31文字だけを使う", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateJoinCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/);
    }
  });

  it("150枚作っても重ならない（既存のコードを避ける）", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 150; i++) codes.add(generateJoinCode(codes));
    expect(codes.size).toBe(150);
  });

  it("既存のコードと同じものが出たら作り直す", () => {
    const first = generateJoinCode(new Set(), seededRandom(7));
    // 同じ乱数の並びで、1つ目を既存にすると別のコードになる
    const second = generateJoinCode(new Set([first]), seededRandom(7));
    expect(second).not.toBe(first);
  });

  it("表示用に3文字ずつハイフンで区切る", () => {
    expect(formatJoinCode("K7P3QX")).toBe("K7P-3QX");
  });

  it.each([
    ["K7P3QX", "K7P3QX"],
    ["K7P-3QX", "K7P3QX"],
    ["k7p-3qx", "K7P3QX"],
    [" k7p 3qx ", "K7P3QX"],
    ["K7P\t-　3QX", "K7P3QX"],
    ["Ｋ７Ｐ－３ＱＸ", "K7P3QX"], // 全角
    ["K7Pー3QX", "K7P3QX"], // 長音記号で区切った
  ])("入力 %j を %s にそろえる", (input, expected) => {
    expect(normalizeJoinCode(input)).toBe(expected);
  });

  it.each([
    ["", "空"],
    ["K7P3Q", "5文字"],
    ["K7P3QXA", "7文字"],
    ["K7P3Q0", "使わない文字（0）"],
    ["K7P3QI", "使わない文字（I）"],
    ["K7P3Q!", "記号"],
    ["K7P_3QX", "ハイフン以外の区切り"],
  ])("%j（%s）は受け付けない", (input) => {
    expect(normalizeJoinCode(input)).toBeNull();
  });
});

describe("ID とトークン（security 2章）", () => {
  it("ルーム ID は12文字の英小文字と数字", () => {
    expect(generateRoomId()).toMatch(/^[a-z0-9]{12}$/);
  });

  it("司会トークンは URL で使える文字で256ビット以上", () => {
    const t = generateHostToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(43 * Math.log2(64)).toBeGreaterThanOrEqual(256);
  });

  it("参加者 ID は16文字", () => {
    expect(generateParticipantId()).toMatch(/^[a-z0-9]{16}$/);
  });

  it("毎回違う値になる", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateHostToken()));
    expect(tokens.size).toBe(100);
  });
});
