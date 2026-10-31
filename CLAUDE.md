# Bingo (Cloudflare Workers)

会場イベント（〜100人）向けリアルタイムビンゴ大会アプリ。仕様は `docs/spec.md`（目次）から各文書をたどって参照する。仕様を変えたら該当の文書も更新する。
企画文書 #1〜#9 は確定済み。「状態: 確定」になっていない文書（運用計画・用語集など）の内容は、ユーザーに確認してから実装に使う。

## 技術スタック
- Next.js (App Router) + `@opennextjs/cloudflare` で Workers にデプロイ
- Cloudflare Agents SDK (`agents`) の `Agent`（Durable Object）でルーム状態を管理・同期
- TypeScript / Vitest（`@cloudflare/vitest-pool-workers`）
- 1つの Worker に Next.js と Agent を同居（カスタムエントリ `worker.ts`）

## 構成（予定）
- `worker.ts` — `/agents/*` を `routeAgentRequest` へ、それ以外を OpenNext handler へ。`BingoRoom` と `RoomDirectory` を export
- `src/agents/bingo-room.ts` — ルームの Agent（1ルーム=1インスタンス、名前=roomId）
- `src/agents/room-directory.ts` — ルーム一覧の Agent（インスタンスは1つ。合言葉で守る）
- `src/lib/` — 純粋関数（`bingo.ts` ゲームロジック、参加コードの生成・正規化、入力チェック、CSV）
- `src/app/` — `/`（管理：ルーム一覧・作成）, `/host/[roomId]`（司会）, `/room/[roomId]`（参加者）, `/screen/[roomId]`（投影・表示のみ）

## コマンド（Phase 2 で確定させる）
- `npm run dev` / `npm run preview` / `npm test` / `npm run deploy`

## 規約・注意
- **司会トークン・参加コード・参加者カードを Agent の公開 state に入れない**（state は全クライアントにブロードキャストされる）。非公開データは `this.sql` に保存
- 管理画面（ルームの一覧・作成・削除）は管理用の合言葉（Secret）をサーバー側で確認する。合言葉をコードやリポジトリに書かない
- 司会操作（開始・抽選・終了・参加者削除・コード発行/表示/差し替えなど）は、司会トークンで名乗った接続からの要求かを必ずサーバー側で確かめる
- 秘密の値（司会トークン・参加コード・合言葉）は WebSocket の URL に入れず、接続後に callable で送る。ページ URL の `?t=` `?c=` は読み取ったらすぐ消す（docs/design/security.md）
- リーチ/ビンゴ判定はサーバー側で行う。ロジックは `src/lib/bingo.ts` の純粋関数に寄せてテストする
- 75ボール方式: B1-15 / I16-30 / N31-45（中央FREE）/ G46-60 / O61-75
- OpenNext・Agents SDK は変化が速いので、実装前に公式ドキュメントで最新 API を確認する
- フェーズごとに小さく実装 → テスト → コミット
