import { describe, expect, it } from "vitest";
import { checkNickname, checkRoomName, sanitizeText } from "../../src/lib/validate";

describe("入力チェック（domain-model 8章・security 5章）", () => {
  it("前後の空白（全角を含む）を除く", () => {
    expect(sanitizeText("  たろう　")).toBe("たろう");
  });

  it("制御文字と、文字の向きを変える書式文字を除く", () => {
    expect(sanitizeText("た\u0000ろ\nう\u007f‮")).toBe("たろう");
  });

  it("絵文字の結合（ZWJ）は残す", () => {
    expect(sanitizeText("👨‍👩‍👧")).toBe("👨‍👩‍👧");
  });

  describe("ニックネーム：1〜20文字", () => {
    it.each([
      ["a", "a"],
      [" たろう ", "たろう"],
      ["あ".repeat(20), "あ".repeat(20)],
      ["😀".repeat(20), "😀".repeat(20)], // 絵文字も1文字と数える
    ])("%j は OK", (input, value) => {
      expect(checkNickname(input)).toEqual({ ok: true, value });
    });

    it.each([
      ["", "空"],
      ["   ", "空白だけ"],
      ["\u0000\u0001", "制御文字だけ"],
      ["あ".repeat(21), "21文字"],
      [123, "文字列でない"],
      [undefined, "未入力"],
    ])("%j（%s）は NG", (input) => {
      expect(checkNickname(input)).toEqual({ ok: false });
    });
  });

  describe("ルーム名：1〜40文字", () => {
    it("40文字は OK、41文字は NG", () => {
      expect(checkRoomName("忘".repeat(40))).toEqual({ ok: true, value: "忘".repeat(40) });
      expect(checkRoomName("忘".repeat(41))).toEqual({ ok: false });
    });

    it("前後の空白を除いてから数える", () => {
      expect(checkRoomName(`  ${"忘".repeat(40)}  `).ok).toBe(true);
      expect(checkRoomName(" ").ok).toBe(false);
    });
  });
});
