# Bingo (Cloudflare Workers)

会場イベント（〜100人）向けリアルタイムビンゴ大会アプリ。仕様は `docs/spec.md`（目次）から各文書をたどって参照する。仕様を変えたら該当の文書も更新する。
企画文書 #1〜#9 は確定済み。「状態: 確定」になっていない文書（運用計画・用語集など）の内容は、ユーザーに確認してから実装に使う。

## 技術スタック
- Next.js (App Router) + `@opennextjs/cloudflare` で Workers にデプロイ
- Cloudflare Agents SDK (`agents`) の `Agent`（Durable Object）でルーム状態を管理・同期
- TypeScript / Vitest（`@cloudflare/vitest-plugin`。旧名 `@cloudflare/vitest-pool-workers`）
- UI：Tailwind CSS v4 ＋ shadcn/ui（Radix）。部品は `pnpm dlx shadcn@4 add <名前>` で `src/components/ui/` に足す（コピーした部品なので直してよい）。管理・司会は shadcn/ui、参加者は軽い部品だけ、投影・印刷は Tailwind で直接書く（ADR 0006）
- パッケージ管理は **pnpm**（npm・yarn は使わない。`pnpm-lock.yaml` をコミットする）
- 1つの Worker に Next.js と Agent を同居（カスタムエントリ `worker.ts`）

## 構成
- `worker.ts` — `/agents/*` を `routeAgentRequest` へ、それ以外を OpenNext handler へ。`BingoRoom` と `RoomDirectory` を export
- `wrangler.jsonc` — Worker の設定（DO のバインディング・マイグレーション）。変えたら `pnpm cf-typegen` で `cloudflare-env.d.ts` を作り直す
- `test/` — Vitest（workerd 上で実行）。`test/worker.ts` は OpenNext の生成物に頼らず Agent だけを動かすテスト用エントリ。確認用の callable（役割を書き換えるなど本番に入れてはいけないもの）は、ここで本番のクラスを継承して足す。`test/lib/` は `src/lib/` の単体テスト（乱数は `test/helpers/seeded-random.ts` で固定する）。BingoRoom の結合テストは `test/helpers/room.ts` の道具でルームを作って司会・参加者としてつなぐ
- `src/agents/bingo-room.ts` — ルームの Agent（1ルーム=1インスタンス、名前=roomId）
- `src/agents/room-directory.ts` — ルーム一覧の Agent（インスタンスは1つ。合言葉で守る）
- `src/lib/` — 純粋関数（`bingo.ts` ゲームロジック、`join-code.ts` 参加コードの生成・正規化、`ids.ts` ルーム ID・司会トークン、`validate.ts` 入力チェック、`csv.ts` CSV、`random.ts` 暗号論的な乱数）。乱数を使う関数は `RandomInt` を引数で受け取る。`utils.ts` は shadcn の `cn()`
- `src/components/ui/` — shadcn/ui からコピーした部品
- `src/app/` — `/`（管理：ルーム一覧・作成。今は Phase 2 の疎通確認ページで、Phase 5 で置き換える）, `/host/[roomId]`（司会）, `/room/[roomId]`（参加者）, `/screen/[roomId]`（投影・表示のみ）

## コマンド
- `pnpm dev` — Next.js だけ（画面の見た目の確認用。Agent にはつながらない）
- `pnpm preview` — OpenNext でビルドして、Worker 全体（画面＋Agent）を :8787 で動かす
- `pnpm test` — Vitest（workerd 上）
- `pnpm typecheck` / `pnpm lint`
- `pnpm run deploy` — ビルドして Cloudflare にデプロイ（**本番当日はしない**。実行前にユーザーに確認する）。`run` を省くと pnpm 自身の `deploy` コマンドが動くので必ず付ける
- `pnpm cf-typegen` — `wrangler.jsonc` から型（`cloudflare-env.d.ts`）を作る
- ローカルの秘密の値は `.dev.vars`（`.dev.vars.example` をコピー。コミットしない）

## 規約・注意
- **司会トークン・参加コード・参加者カードを Agent の公開 state に入れない**（state は全クライアントにブロードキャストされる）。非公開データは `this.sql` に保存
- 管理画面（ルームの一覧・作成・削除）は管理用の合言葉（Secret）をサーバー側で確認する。合言葉をコードやリポジトリに書かない
- 司会操作（開始・抽選・終了・参加者削除・コード発行/表示/差し替えなど）は、司会トークンで名乗った接続からの要求かを必ずサーバー側で確かめる
- 秘密の値（司会トークン・参加コード・合言葉）は WebSocket の URL に入れず、接続後に callable で送る。ページ URL の `?t=` `?c=` は読み取ったらすぐ消す（docs/design/security.md）
- リーチ/ビンゴ判定はサーバー側で行う。ロジックは `src/lib/bingo.ts` の純粋関数に寄せてテストする
- 75ボール方式: B1-15 / I16-30 / N31-45（中央FREE）/ G46-60 / O61-75
- OpenNext・Agents SDK は変化が速いので、実装前に公式ドキュメントで最新 API を確認する
- Agent の型引数の env は `Cloudflare.Env` を使う（OpenNext が別に宣言する `CloudflareEnv` は項目が省略可能になっていて型が合わない）
- 公開 state はクライアントからも書き換えられるので、`validateStateChange` でサーバー以外からの変更を拒否する。画面では `setState` を使わず、`onStateUpdate` の `source === "server"` の state だけを表示に使う（docs/design/api.md 7章）
- `@callable()` は TC39 標準のデコレーター。`experimentalDecorators` を有効にしない
- フェーズごとに小さく実装 → テスト → コミット
