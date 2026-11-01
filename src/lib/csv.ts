// CSV の書き出し（F-10。docs/design/security.md 5章）
// Excel で文字化けしないよう BOM を付け、式として動かないよう = + - @ で始まる値の前に ' を付ける。

export type CsvValue = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r]/;

function escapeField(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  let s = typeof value === "number" ? String(value) : value;
  if (typeof value === "string" && FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 行の配列を CSV の文字列にする（BOM 付き・改行は CRLF） */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  return "﻿" + rows.map((row) => row.map(escapeField).join(",")).join("\r\n") + "\r\n";
}
