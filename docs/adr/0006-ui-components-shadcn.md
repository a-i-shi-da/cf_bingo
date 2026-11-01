# 0006 UI の部品に shadcn/ui（Radix）を使う

- 状態: 採用（2026-11-01）

## 背景
画面のスタイルは Tailwind CSS v4 で書く。画面設計（screens.md）には、確認ポップアップ（6か所）・司会画面のタブ・参加者一覧の [⋯] メニュー・入力欄など、自分で作るとキーボード操作やフォーカスの扱いで不具合が出やすい部品が多い。

## 決定
shadcn/ui を使う（土台は Radix。`components.json` の style は new-york、色は CSS 変数）。部品は `pnpm dlx shadcn@4 add <名前>` で `src/components/ui/` にコピーし、使う画面を作るフェーズで必要な分だけ足す。

画面ごとの使い分け：
| 画面 | 使い方 |
|---|---|
| 管理（S-01）・司会（S-02） | shadcn/ui の部品を使う |
| 参加者（S-04） | Button・Input など軽い部品だけ。重い部品は入れない（4G で3秒以内に表示。non-functional 1章） |
| 投影（S-05）・印刷（S-03） | 演出やレイアウトが特殊なので、Tailwind で直接書く |

- 確認ポップアップは「元のボタンより少し上にずらす」（screens.md 4-4）ので、Dialog と Popover のどちらで作るかを Phase 6 で決める

## 理由
- shadcn/ui は部品のソースをリポジトリにコピーする方式なので、ライブラリの更新に振り回されず、自分たちで直せる
- Radix がキーボード操作・フォーカス・ARIA を受け持つので、確認ポップアップやメニューを安全に作れる
- 使った部品だけが入るので、通信量への影響が小さい（Button を入れた時点で Worker は +約 50 KiB、gzip で +約 15 KiB）
- Tailwind v4・React 19・Next.js 16 にそのまま対応している

## 影響
- 依存が増える：`radix-ui`、`class-variance-authority`、`cn`（shadcn 製。clsx＋tailwind-merge の代わり）、`lucide-react`（アイコン）、`tw-animate-css`、`shadcn`（CLI。開発用）
- `src/components/ui/` はコピーした部品なので、直してよい。ただし直したら、あとで `shadcn add` で上書きしないよう注意する
- `globals.css` の色トークン（`--primary` など）は shadcn の形式に合わせる。フォントは端末のものを使う（`--font-sans` にシステムフォントを指定）
