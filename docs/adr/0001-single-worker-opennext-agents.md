# 0001 OpenNext と Agents SDK を1つの Worker に同居させる

- 状態: 採用（2026-10-31）

## 背景
画面は Next.js（App Router）で作り、`@opennextjs/cloudflare` で Workers に載せる。リアルタイムの同期には、Cloudflare Agents SDK の Agent（Durable Object）を使う。画面用と Agent 用で、Worker を2つに分けることもできる。

## 決定
1つの Worker にまとめる。カスタムエントリ `worker.ts` で、`/agents/*` は `routeAgentRequest` へ、それ以外は OpenNext の handler へ振り分ける。`BingoRoom` と `RoomDirectory` はこのエントリから export する。

## 理由
- デプロイと設定（`wrangler.jsonc`）が1つで済み、少人数の開発でも管理しやすい
- 画面と WebSocket が同じドメインになるので、CORS や Cookie の設定が要らない
- Durable Object のバインディングを画面側（サーバー処理）からも直接使える

## 影響
- OpenNext の生成物（`.open-next/worker.js`）を取り込むカスタムエントリが必要になる。OpenNext の更新で作り方が変わる可能性があるため、Phase 2 で最初に動作を確かめる
- 画面の不具合を直すデプロイで、Agent も一緒に更新される。本番当日はデプロイしない（operations.md）
- （2026-11-01 Phase 2 で確認）カスタムエントリは、`.open-next/worker.js` の default export の `fetch` を呼ぶ形で動いた。`pnpm preview` で、画面と `/agents/*` の WebSocket が同じ Worker で動くことを確かめた
- テストは OpenNext の生成物に頼らないよう、Agent だけを export するテスト用エントリ（`test/worker.ts`）を使う
