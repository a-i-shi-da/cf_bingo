import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  // OG 画像（src/app/opengraph-image.png）の URL を絶対 URL にするための基準（docs/operations.md の本番 URL）
  metadataBase: new URL("https://bingo.example.workers.dev"),
  title: "ビンゴ大会",
  description: "会場イベント向けリアルタイムビンゴ",
  openGraph: {
    type: "website",
    siteName: "ビンゴ大会",
    title: "ビンゴ大会",
    description: "会場のみんなでリアルタイムビンゴ",
    locale: "ja_JP",
  },
  twitter: { card: "summary_large_image" },
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
