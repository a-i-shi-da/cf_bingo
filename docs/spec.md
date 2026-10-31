# ビンゴ大会アプリ 仕様書（目次）

会場イベント（〜100人）向けのリアルタイムビンゴ大会アプリ。Cloudflare Workers 上で、Next.js（OpenNext）と Agents SDK（Durable Objects）を使って作る。

## 文書の状態

### A. 実装前に必須（上から順に確定させる）
| # | 文書 | 状態 |
|---|---|---|
| 1 | [企画概要](product/overview.md) | 確定 |
| 2 | [当日の進行シナリオ](product/event-flow.md) | 確定 |
| 3 | [ゲームルール](product/game-rules.md) | 確定 |
| 4 | [機能要件](product/requirements.md) | 確定 |
| 5 | [非機能要件](product/non-functional.md) | 確定 |
| 6 | [画面設計](design/screens.md) | 確定 |
| 7 | [ドメインモデルと状態遷移](design/domain-model.md) | 確定 |
| 8 | [リアルタイム通信仕様](design/api.md) | 確定 |
| 9 | [権限・セキュリティ設計](design/security.md) | 確認待ち |

### B. 実装しながら育てる
- [設計判断の記録（ADR）](adr/README.md)
- [テスト計画](test-plan.md)
- [運用・リリース計画](operations.md)
- [用語集](glossary.md)

## 進め方
1. A の #1 から順に、Claude が論点を質問し、回答を文書に反映する
2. ユーザーが内容を確認したら、状態を「確定」にしてコミットする
3. A がすべて確定したら、下の「実装フェーズ」を見直してから Phase 2 へ進む

## 実装フェーズ（暫定。A の確定後に見直す）
1. 企画書と土台（`CLAUDE.md`、文書一式）
2. 雛形を作り、OpenNext と Agents SDK の同居・WebSocket 接続・デプロイが通ることを確認
3. ゲームロジック（`src/lib/bingo.ts`）と単体テスト
4. Agent（`BingoRoom`）の実装と結合テスト
5. UI（司会画面・参加者画面・QR コード）
6. Clerk 認証（MVP の後）
7. 次期機能（ビンゴ申告、景品管理、演出）
