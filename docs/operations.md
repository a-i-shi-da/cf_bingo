# 運用・リリース計画

> 状態: 下書き（未確定）

## 目的
本番当日に困らないようにする（実装しながら育てる）。

## 決定済み
（なし）

## 本文
（論点が確定したら記入。下は Phase 2 で分かった事実のメモで、手順としてはまだ確定していない）

### メモ：デプロイ（2026-11-03 時点）
- Worker 名：`bingo`。URL：https://bingo.example.workers.dev（workers.dev のサブドメインは 2026-11-01 に変更。URL は `<Worker 名>.<アカウントのサブドメイン>.workers.dev`。サブドメインを変えるとアカウント内のすべての Worker の URL が変わり、印刷した QR も使えなくなる。`.env.production.local` の `SITE_URL` も直す）
- 本番の URL はリポジトリに書かない。ビルド時に `.env.production.local`（コミットしない。`.env.example` をコピー）の `SITE_URL` から OG 画像の URL の基準（`metadataBase`）を作る。無いと `http://localhost:8787` になり、SNS で OG 画像が出ない
- コマンド：`pnpm run deploy`（`opennextjs-cloudflare build && opennextjs-cloudflare deploy`）。`run` を省くと pnpm 自身の `deploy` が動く
- ログイン：`pnpm wrangler login`（devcontainer の `~/.config/.wrangler` に保存。コンテナを作り直しても残る）
- 初回デプロイ（2026-11-01、Version ID `1808c066-883e-460f-9242-ac2d721929b2`）：Worker 約 7.0 MiB（gzip 約 1.4 MiB）、起動時間 58ms
- Phase 7 の負荷試験の前のデプロイ（2026-11-01、Version ID `0a6470c8-5401-4b7e-8a9c-0435ed1c2899`）：Worker 約 7.9 MiB（gzip 約 1.6 MiB）、起動時間 60ms
- 参加者画面の演出待ち・favicon・OGP を入れたデプロイ（2026-11-03、Version ID `f1b50967-ba1e-482d-a23d-65128005c28f`）
- 参加コード印刷の配置の修正を入れたデプロイ（2026-11-03、Version ID `8fbe990d-50b7-4f87-abb8-1aa6a4d7b176`）

## 未決事項
- [ ] dev／prod の環境
- [ ] デプロイ手順
- [ ] 当日のチェックリスト
- [ ] 障害時の対応
- [ ] 本番当日はデプロイしない（ADR 0001）。デプロイを止める期間の決め方
