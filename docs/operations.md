# 運用・リリース計画

> 状態: 下書き（未確定）

## 目的
本番当日に困らないようにする（実装しながら育てる）。

## 決定済み
（なし）

## 本文
（論点が確定したら記入。下は Phase 2 で分かった事実のメモで、手順としてはまだ確定していない）

### メモ：デプロイ（2026-11-01 時点）
- Worker 名：`bingo`。URL：https://bingo.example.workers.dev（workers.dev のサブドメインは 2026-11-01 に変更。URL は `<Worker 名>.<アカウントのサブドメイン>.workers.dev`。サブドメインを変えるとアカウント内のすべての Worker の URL が変わり、印刷した QR も使えなくなる）
- コマンド：`pnpm run deploy`（`opennextjs-cloudflare build && opennextjs-cloudflare deploy`）。`run` を省くと pnpm 自身の `deploy` が動く
- ログイン：`pnpm wrangler login`（devcontainer の `~/.config/.wrangler` に保存。コンテナを作り直しても残る）
- 初回デプロイ（2026-11-01、Version ID `1808c066-883e-460f-9242-ac2d721929b2`）：Worker 約 7.0 MiB（gzip 約 1.4 MiB）、起動時間 58ms

## 未決事項
- [ ] dev／prod の環境
- [ ] デプロイ手順
- [ ] 当日のチェックリスト
- [ ] 障害時の対応
- [ ] 本番当日はデプロイしない（ADR 0001）。デプロイを止める期間の決め方
