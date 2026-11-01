import { describe, expect, it } from "vitest";
import { toCsv } from "../../src/lib/csv";

describe("CSV（F-10・security 5章）", () => {
  it("BOM で始まり、改行は CRLF", () => {
    const csv = toCsv([
      ["順位", "ニックネーム"],
      [1, "たろう"],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿順位,ニックネーム\r\n1,たろう\r\n");
  });

  it.each(["=SUM(A1)", "+1", "-1", "@cmd", "\tx"])("%j で始まる値の前に ' を付ける", (v) => {
    expect(toCsv([[v]])).toBe(`﻿'${v}\r\n`);
  });

  it("数値はそのまま（負の数にも ' を付けない）", () => {
    expect(toCsv([[-1, 0, 12]])).toBe("﻿-1,0,12\r\n");
  });

  it("カンマ・ダブルクォート・改行を含む値はクォートする", () => {
    expect(toCsv([['a,b', 'say "hi"', "x\ny"]])).toBe('﻿"a,b","say ""hi""","x\ny"\r\n');
  });

  it("式の対策とクォートを両方行う", () => {
    expect(toCsv([["=1,2"]])).toBe("﻿\"'=1,2\"\r\n");
  });

  it("null・undefined は空欄", () => {
    expect(toCsv([["a", null, undefined, "b"]])).toBe("﻿a,,,b\r\n");
  });
});
