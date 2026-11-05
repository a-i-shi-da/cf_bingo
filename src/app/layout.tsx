import type { Metadata } from "next";
import "./globals.css";

// OG 画像（src/app/opengraph-image.png）の URL を絶対 URL にするための基準。
// 本番の URL はリポジトリに書かず、ビルド時に .env.production.local の SITE_URL から読む（docs/operations.md）
const siteUrl = process.env.SITE_URL || "http://localhost:8787";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
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
