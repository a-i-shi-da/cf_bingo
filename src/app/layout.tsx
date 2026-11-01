import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ビンゴ大会",
  description: "会場イベント向けリアルタイムビンゴ",
};

// Web フォントは読み込まず、端末に入っているフォントを使う（non-functional 6章）
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // 全画面でパーティー風の濃い色のテーマを使う（screens.md 2章）
    <html lang="ja" className="dark">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
