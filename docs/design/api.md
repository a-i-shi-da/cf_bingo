# リアルタイム通信仕様

> 状態: 確定（2026-11-01 に改訂。下の「変更履歴」を参照）

## 目的
クライアント（画面）と Agent（BingoRoom・RoomDirectory）のあいだの取り決めを定める。データの項目は domain-model.md、機能 ID（F-xx）は requirements.md を参照。

## 決定済み
- 公開 state は setState で全クライアントに配信される
- 司会トークン・参加コード・参加者カードは公開 state に入れず this.sql に保存する
- 抽選・終了などの司会操作は Agent が1つずつ処理し、間隔の短い抽選要求は無視する（複数の司会が同時に押しても番号が重複しない）
- 参加者に送る公開 state は最小限にする（引かれた番号・状態・人数・ビンゴした人）。参加者一覧の全体は司会だけに送り、自分のリーチ/ビンゴは本人だけに送る（通信量を1ゲーム数百 KB 以内にするため。#5）
- **送り方は3つを使い分ける**：①公開 state（setState。全員に同じものを送る）②個別メッセージ（connection.send。司会だけ・本人だけに送る）③callable（`@callable()`。画面からサーバーへの操作）
- **秘密の値（司会トークン・参加コード・合言葉）は WebSocket の URL に入れない**。接続したあとに callable で送り、サーバーがその接続に役割を記録する

## 本文

### 1. 接続と役割
```
画面 ──WebSocket──▶ BingoRoom（名前 = roomId）
  1. 接続する（URL には roomId だけ）
  2. 公開 state を受け取る（この時点で誰でも見られる情報）
  3. callable で名乗る：authHost(token)／authScreen()／join(code, nickname)／resume(code)
  4. サーバーが接続に役割を記録する（connection.setState）
  5. 役割に応じた個別メッセージが届き始める
```
| 役割 | 名乗り方 | 受け取るもの |
|---|---|---|
| guest（名乗る前） | — | 公開 state だけ |
| screen（投影） | `authScreen()` | 公開 state |
| player（参加者） | `join` または `resume` | 公開 state ＋ 自分の情報（`player:self`） |
| host（司会） | `authHost(token)` | 公開 state ＋ 参加者一覧（`host:participants`）＋ コードの枚数（`host:codes`） |

- 1つの接続が持てる役割は1つ。司会の操作（4章）は host の接続からしか受け付けない。名乗り直すと役割は置き換わる
- RoomDirectory が初期化していないルーム（削除済みを含む）に接続すると、`room:not-found` を送って切る（公開 state は空のものが先に届く）
- 秘密の値を URL に入れない理由：URL はアクセスログやブラウザの履歴に残りやすいため
- ただし **司会用 URL の `?t=` と個別 QR の `?c=` はページの URL** なので、ページを開いたあと画面のプログラムがその値を読み、callable で送る（読み取ったらすぐアドレスバーから消す。#9 の3章）

### 2. 公開 state（全員に配る）
```ts
type RoomPublicState = {
  roomId: string;
  name: string;                       // ルーム名
  status: "waiting" | "playing" | "finished";
  drawn: number[];                    // 引いた番号（順番どおり。drawn[0] が1回目）
  lastDrawnAt: number | null;         // 最後に引いた時刻（演出と、抽選を受け付けない時間の表示に使う）
  participantCount: number;           // 参加人数（削除された人は数えない）
  reachCount: number;                 // リーチの人数（ビンゴ済みは数えない）
  winners: { nickname: string; rank: number; atSeq: number }[];  // ビンゴした人（順位順）
  startedAt: number | null;           // 開始した時刻
  finishedAt: number | null;
  deleteAt: number | null;            // 終了後の削除予定（終了後だけ入る）
};
```
- 大きさは最大でも 2〜3 KB 程度（75個の番号と、ビンゴした人の名前）
- 配るタイミング：参加・削除・開始・抽選・終了のとき
- 通信量の見込み：抽選75回＋参加100回 ≒ 175回 × 約1〜2 KB ≒ **1ゲームで約 200〜350 KB**（#5 の「数百 KB 以内」に収まる）
- 参加者のカードのマークは、`drawn` と自分のカードから画面側で計算する（マークは送らない）
- 投影画面は `drawn` が増えたことで新しい抽選を知り、演出を始める

### 3. 個別メッセージ（サーバー → 画面）
すべて JSON で、`type` で種類を見分ける。

| type | 送り先 | 送るタイミング | 中身 |
|---|---|---|---|
| `player:self` | その参加者の接続 | 名乗ったとき、自分のリーチ・ビンゴ・揃ったライン数が変わったとき | ニックネーム・カード（5×5）・リーチ数・揃ったライン数・ビンゴ順位・何回目でビンゴしたか |
| `player:removed` | その参加者の接続 | 司会が削除したとき（送ったあと接続を切る） | なし |
| `player:code-replaced` | 古いコードで名乗った接続 | 司会がコードを差し替えたとき（送ったあと接続を切る） | なし |
| `host:token-changed` | 古いトークンで名乗った司会の接続 | 司会用 URL を作り直したとき（送ったあと接続を切る） | なし |
| `host:participants` | host の接続すべて | 名乗ったとき、参加・削除・接続/切断・抽選のあと（多くても1秒に1回にまとめる） | 参加者全員（削除された人を除く）：ID・ニックネーム・接続状態・最終接続時刻・参加日時・参加時の抽選回数・リーチ数・ビンゴ順位・何回目か |
| `host:codes` | host の接続すべて | 名乗ったとき、発行・使用・無効化・差し替え・参加者の削除のあと | 発行済み（無効を含む合計）・使用済み・未使用・無効の枚数 |
| `room:deleted` | 全員 | ルームを削除するとき（送ったあと全員の接続を切る） | なし |
| `room:not-found` | 接続した人 | 初期化されていない（または削除済みの）ルームに接続したとき（送ったあと接続を切る） | なし |

- カードは `number[][]`（`cells[行][列]`。列は B・I・N・G・O の順）で、中央の FREE は `0`（`src/lib/bingo.ts` の `Card`・`FREE`）
- `player:self` のカードは、名乗ったときに1回だけ送る。それ以降は、リーチ・ビンゴが変わったときに数字だけを送る
- 同じ参加者が2台でつないでいる場合（復帰したときなど）は、両方に送る
- 中身の型は `src/agents/types.ts` の `ServerMessage`

#### 3-1. サーバーが接続を切るときのコード
| コード | 理由 |
|---|---|
| 4001 | 司会用 URL が作り直された（`host:token-changed` のあと） |
| 4003 | 参加者が削除された／コードが差し替えられた（`player:removed`・`player:code-replaced` のあと） |
| 4029 | 司会トークンを間違え続けた（`RATE_LIMITED` を返したあと） |
| 4404 | ルームがない（`room:not-found` のあと） |
| 4410 | ルームが削除された（`room:deleted` のあと） |

- 画面は、これらのコードで切られたときは自動で再接続しない

### 4. callable（画面 → サーバー）
戻り値はすべて `{ ok: true, ... }` か `{ ok: false, error: エラーコード }`。エラーコードは 6章。

#### 4-1. BingoRoom：だれでも呼べる
| メソッド | 引数 | 戻り値（成功時） | 主なエラー | 機能 |
|---|---|---|---|---|
| `authScreen()` | — | — | — | F-30 |
| `authHost(token)` | 司会トークン | — | `BAD_TOKEN` `RATE_LIMITED` | 司会画面 |
| `join(code, nickname)` | 参加コード、ニックネーム | 自分の情報（`player:self` と同じ） | `CODE_INVALID` `CODE_REVOKED` `NICKNAME_TAKEN` `NICKNAME_INVALID` `ROOM_FULL` `ROOM_FINISHED` `LATE_JOIN_CLOSED` `RATE_LIMITED` | F-20 |
| `resume(code)` | 参加コード | 自分の情報 | `CODE_UNUSED`（ニックネーム入力へ） `CODE_INVALID` `CODE_REVOKED` `RATE_LIMITED` | F-21 |
| `ping()` | — | `{ name, now }` | — | 疎通確認（秘密の値は返さない） |

- `join` に使用済みのコードが来たときは、ニックネームを無視して `resume` と同じ動きにする（元のカードに戻る）。この場合は `ROOM_FULL` `ROOM_FINISHED` `LATE_JOIN_CLOSED` にならない
- どこかの列の番号がすべて引かれたあとの新しい参加は `LATE_JOIN_CLOSED`（game-rules 7章。判定は `src/lib/bingo.ts` の `isLateJoinClosed`）
- 開き直したときは、ブラウザに保存した参加コードで `resume` を呼ぶ
- 「自分の情報」は `{ self: PlayerSelf }`（`player:self` と同じ中身。カード付き）。同じものを `player:self` でも送る
- `join` で確かめる順番：試行回数の制限 → コード（`CODE_INVALID` `CODE_REVOKED`。使用済みなら復帰）→ `ROOM_FINISHED` → `NICKNAME_INVALID` → `ROOM_FULL` → `LATE_JOIN_CLOSED` → `NICKNAME_TAKEN`
- どのメソッドも、初期化されていないルームでは `ROOM_NOT_FOUND`

#### 4-2. BingoRoom：司会だけ（host の接続から）
| メソッド | 引数 | 戻り値（成功時） | 主なエラー | 機能 |
|---|---|---|---|---|
| `start()` | — | — | `NOT_WAITING` | F-04 |
| `draw()` | — | `{ seq, number }` | `NOT_PLAYING` `COOLDOWN` `NO_NUMBERS_LEFT` | F-05 |
| `finish()` | — | — | `NOT_PLAYING` | F-06 |
| `issueCodes(count)` | 枚数（1〜） | `{ codes }`（発行したコードの一覧） | `CODE_LIMIT`（無効・差し替えを含めて合計150枚を超える） `ROOM_FINISHED` `INVALID_ARGUMENT` | F-02 |
| `listCodes(filter)` | `"unused"` または `"all"`（all でも無効のコードは除く） | `{ codes: { code, status, issuedAt }[] }`（発行順） | `INVALID_ARGUMENT` | F-03 印刷 |
| `getParticipantCode(participantId)` | 参加者 ID | `{ code }` | `NOT_FOUND` | F-09 |
| `removeParticipant(participantId)` | 参加者 ID | — | `NOT_FOUND` `ROOM_FINISHED` | F-08 |
| `replaceParticipantCode(participantId)` | 参加者 ID | `{ code }`（新しい参加コード） | `NOT_FOUND` `CODE_LIMIT` `ROOM_FINISHED` | F-11 |
| `revokeCode(code)` | 未使用の参加コード | — | `NOT_FOUND` `CODE_USED` `ROOM_FINISHED` | F-11 |
| `exportResults()` | — | `{ csv }`（CSV の文字列。Excel 用に BOM 付き） | — | F-10 |

- host 以外の接続から呼ばれたら `FORBIDDEN`
- 確認ポップアップは画面側で出す。サーバーは確認の有無を知らない
- ニックネームの検索（F-09）は、`host:participants` を使って画面側で行う
- 司会トークンを作り直す前に名乗った接続は、切られるまでの間も司会の操作を `FORBIDDEN` にする
- CSV の列：順位・ニックネーム・ビンゴした抽選回・リーチ数・揃ったライン数・参加した日時（日本時間）・参加時の抽選回数。並びは司会画面と同じ（ビンゴ → リーチ → 参加順）。削除された参加者と参加コードは入れない

#### 4-3. RoomDirectory：合言葉が必要（管理画面 S-01）
RoomDirectory は1つだけ（名前は固定で `main`）。どのメソッドも、毎回合言葉を引数で受け取って確かめる。

| メソッド | 引数 | 戻り値（成功時） | 主なエラー | 機能 |
|---|---|---|---|---|
| `checkPassphrase(pass)` | 合言葉 | — | `BAD_PASSPHRASE` | 3-1 合言葉の入力 |
| `listRooms(pass)` | 合言葉 | ルームの一覧（ID・名前・状態・作成日・削除予定日・司会用 URL） | `BAD_PASSPHRASE` | F-16 |
| `createRoom(pass, name)` | 合言葉、ルーム名 | `{ roomId, hostUrl }` | `BAD_PASSPHRASE` `NAME_INVALID` | F-01 |
| `regenerateHostToken(pass, roomId)` | 合言葉、ルーム ID | `{ hostUrl }`（新しい司会用 URL） | `BAD_PASSPHRASE` `NOT_FOUND` | F-40 |
| `deleteRoom(pass, roomId, confirmName)` | 合言葉、ルーム ID、確認用に入力したルーム名 | — | `BAD_PASSPHRASE` `NAME_MISMATCH` `ROOM_PLAYING` | F-19 |

- `createRoom` は、RoomDirectory が roomId と司会トークンを作り、BingoRoom を初期化する（Agent どうしの呼び出し。画面からは呼べない）
- `regenerateHostToken` は、RoomDirectory と BingoRoom の両方の司会トークンを新しくし、BingoRoom が古いトークンの司会接続に `host:token-changed` を送って切る

#### 4-4. Agent どうしの呼び出し（`@callable()` ではない。画面からは呼べない）
| 呼ぶ側 → 呼ばれる側 | メソッド | 内容 | 主なエラー |
|---|---|---|---|
| RoomDirectory → BingoRoom | `initRoom(name, hostToken)` | ルームを初期化し、30日後の期限の確認を予約する | `ALREADY_INITIALIZED` `NAME_INVALID` `INVALID_ARGUMENT` |
| RoomDirectory → BingoRoom | `setHostToken(hostToken)` | 司会トークンを替え、古いトークンの司会接続を切る | `ROOM_NOT_FOUND` `INVALID_ARGUMENT` |
| RoomDirectory → BingoRoom | `deleteRoom()` | 全員に `room:deleted` を送ってデータを消す（RoomDirectory への通知はしない） | `ROOM_NOT_FOUND` `ROOM_PLAYING` |
| BingoRoom → RoomDirectory | `roomChanged(roomId, { status, deleteAt })` | 開始・終了したとき | — |
| BingoRoom → RoomDirectory | `roomDeleted(roomId)` | 期限が来て自動で削除したとき | — |

- BingoRoom から RoomDirectory への通知は、失敗しても操作は止めない（ログに残す）
- BingoRoom は、状態が変わったとき（開始・終了・自動削除）に RoomDirectory に知らせ、一覧の状態を更新する（手で削除したときは RoomDirectory が呼ぶ側なので知らせない。4-4）

### 5. サーバーの中の処理

#### 5-1. 抽選（`draw`）
1. 呼んだ接続が host か確かめる
2. 状態が playing か、75個引き切っていないか確かめる
3. 前の抽選から3秒たっていなければ `COOLDOWN`（演出の約3秒と同じ。#6）
4. まだ引いていない番号から、暗号論的な乱数で1つ選ぶ
5. 参加者全員（接続していない人も含む）のリーチ・ビンゴを計算し、新しくビンゴになった人に順位を付ける（同じ回なら同着。#3）
6. 抽選結果と参加者の記録を保存する
7. 公開 state を更新して全員に配る
8. リーチ・ビンゴが変わった参加者に `player:self`、司会に `host:participants` を送る

- Durable Object は要求を1つずつ処理するので、司会2人がほぼ同時に押しても、2つ目は手順3で `COOLDOWN` になる（結合テストで確認）

#### 5-2. 接続と切断
- 接続したとき・切れたときに、その参加者の接続状態と最終接続時刻を更新し、司会に知らせる
- 参加者のどれか1つの接続が生きていれば「オンライン」
- 接続や操作があるたびに、最後に使われた日時を更新する。放置ルームの削除はこの日時から30日後（#7。予約のしかたは 5-3）

#### 5-3. 自動削除
- 終了したとき、7日後の削除を予約する（Agent のスケジュール機能）
- 放置ルームは、作成時に30日後の確認（`checkExpiry`）を予約する。確認のときに「最後に使われた日時＋30日」を過ぎていなければ、その日時に確認を予約し直す（使うたびに予約を入れ直さない）
- 削除するときは、`room:deleted` を送って全員の接続を切り、データを消し、RoomDirectory に知らせる

### 6. エラーコード
| コード | 意味 | 画面での表示（例） |
|---|---|---|
| `BAD_TOKEN` | 司会トークンが違う | この司会用 URL は使えません |
| `RATE_LIMITED` | 間違いが続いたので、しばらく受け付けない（#9 の 2-2） | しばらくしてからもう一度お試しください |
| `CODE_USED` | 使用済みのコードを無効にしようとした | 使用済みのコードは「差し替え」を使ってください |
| `FORBIDDEN` | 司会でない接続から司会の操作を呼んだ | 操作する権限がありません |
| `BAD_PASSPHRASE` | 合言葉が違う | 合言葉が違います |
| `CODE_INVALID` | 存在しない参加コード | このコードは使えません |
| `CODE_REVOKED` | 無効にされた参加コード | このコードは使えません。受付にお問い合わせください |
| `CODE_UNUSED` | `resume` に未使用のコードが来た | （ニックネームの入力画面を出す） |
| `NICKNAME_TAKEN` | ニックネームが使われている | このニックネームはすでに使われています |
| `NICKNAME_INVALID` | ニックネームが空・長すぎる | ニックネームは1〜20文字で入力してください |
| `NAME_INVALID` | ルーム名が空・長すぎる | ルーム名は1〜40文字で入力してください |
| `NAME_MISMATCH` | 削除の確認で入れたルーム名が違う | ルーム名が一致しません |
| `ROOM_FULL` | 参加者が100人に達した | 定員に達しました |
| `ROOM_FINISHED` | 終了したルームで参加・発行しようとした | このゲームは終了しました |
| `LATE_JOIN_CLOSED` | どこかの列の番号がすべて引かれたあとに、新しく参加しようとした（game-rules 7章） | 途中参加の受付は終了しました |
| `ROOM_PLAYING` | ゲーム中のルームを削除しようとした | ゲーム中のルームは削除できません |
| `NOT_WAITING` `NOT_PLAYING` | 今の状態ではできない操作 | （ボタンを押せないようにしておく） |
| `COOLDOWN` | 前の抽選から3秒たっていない | （何もしない。画面は残り時間を表示している） |
| `NO_NUMBERS_LEFT` | 75個すべて引いた | すべての番号を引きました |
| `CODE_LIMIT` | 参加コードが150枚を超える | これ以上発行できません（上限150枚） |
| `NOT_FOUND` | 参加者・コードが見つからない | 参加者が見つかりません |
| `ROOM_NOT_FOUND` | ルームが初期化されていない（または削除済み） | このルームは見つかりません |
| `ALREADY_INITIALIZED` | 初期化済みのルームを初期化しようとした（Agent どうしの呼び出しだけ） | — |
| `INVALID_ARGUMENT` | 引数の形が違う（枚数が整数でない、など） | — |

### 7. 実装の前に確かめること（Phase 2・確認済み）
2026-11-01 に `agents` 0.32.0 の公式ドキュメント（パッケージ同梱の `docs/`）とスモークテスト（`test/smoke.test.ts`）で確かめた。

| 確かめたこと | 結果 | 確かめ方 |
|---|---|---|
| 公開 state の配信を接続ごとに止める必要がないか | 止めなくてよい。止めたい場合は `shouldSendProtocolMessages(connection, ctx)` で接続ごとに外せる（今回は使わない） | ドキュメント |
| `connection.setState` の役割がハイバネーション後も残るか | 残る（WebSocket の attachment に保存される） | テスト（`evictDurableObject` で追い出してから読み直す） |
| `@callable()` から呼んだ接続を取り出す方法 | `getCurrentAgent()` が `{ agent, connection, request }` を返す | テスト |
| Agent どうしの呼び出し | `getAgentByName(this.env.BingoRoom, roomId)` で取ったスタブのメソッドを直接呼ぶ（Durable Object の RPC。`@callable()` は不要） | テスト |
| Agent のデータをすべて消す方法 | `this.destroy()`。テーブル・アラーム・ストレージを消し、`ctx.abort()` で追い出す（ログにエラーが1行出るが正常） | ドキュメント（Phase 4 でテストする） |

#### わかった注意点（実装で守ること）
- **公開 state は、既定ではクライアントからも書き換えられる**（`useAgent` の `setState`）。BingoRoom では `validateStateChange(next, source)` で `source !== "server"` を拒否する（実装済み・テスト済み）。RoomDirectory は公開 state を使わない
  - **画面（クライアント）の側でも、`setState` は使わず、表示には `onStateUpdate(state, source)` の `source === "server"` の state だけを使う**。クライアントの `setState` は送ると同時に自分の表示を書き換え（`source` は `"client"`）、サーバーが拒否しても元に戻さないため（Phase 2 にブラウザで確認）
  - 「読み取り専用の接続」（`shouldConnectionBeReadonly`）は、その接続から呼んだ callable の中の `setState` まで止めてしまうので使わない
- **`/agents/bingo-room/<好きな名前>` に接続すると、その名前の Agent が作られてしまう**。BingoRoom は、RoomDirectory が作っていないルーム（初期化されていない BingoRoom）への接続・callable を拒否する（Phase 4 で実装）。RoomDirectory も固定の名前（`main`）以外を拒否する（Phase 5）
- callable の中で投げた例外は、クライアントに `error` として返り、サーバーのログに `RPC error:` として出る。想定内のエラーは投げずに `{ ok: false, error }` を返す（4章の決まりどおり）
- **`initialState` は、state がまだ保存されていない Agent でだけ使われる**。公開 state に項目を足しても、すでにあるルームには入らない（Phase 2 で確認）。本番にルームができたあとで項目を足すときは、`onStart` で足りない項目を補う
- `@callable()` は TC39 標準のデコレーター。tsconfig は `target: ES2021` 以上にし、`experimentalDecorators` は使わない。Vitest（Vite 8）では `agents/vite` プラグインが必要

## 未決事項
- [x] URL の `?t=` `?c=` → #9 で決定（読み取ったらすぐアドレスバーから消す）
- [x] 合言葉を試す回数の制限 → #9 で決定（10分間に5回まで）

## 変更履歴
- 2026-10-31 初版を確定
- 2026-10-31 #9 の決定を反映：replaceParticipantCode・revokeCode・regenerateHostToken、メッセージ2種、エラー2種を追加
- 2026-10-31 文書間の矛盾を修正：listCodes の all の範囲、司会トークンの作り直しの流れを明記
- 2026-11-01 公開 state に startedAt を追加（domain-model.md の「公開」に合わせた）。RoomDirectory の名前（`main`）を明記
- 2026-11-01 7章の確認結果を記入（Phase 2）。クライアントからの state の書き換えを拒否すること、初期化していないルームを拒否することを追記
- 2026-11-01 `join` のエラーに `LATE_JOIN_CLOSED` を追加（game-rules 7章）。カードの形（FREE は 0）を明記
- 2026-11-01 Phase 4 の実装に合わせて追記：`room:not-found`、接続を切るときのコード、Agent どうしの呼び出し（4-4）、戻り値の形、エラー（`ROOM_NOT_FOUND` `ALREADY_INITIALIZED` `INVALID_ARGUMENT`、各メソッドの `ROOM_FINISHED` `RATE_LIMITED`）、`join` で確かめる順番、CSV の列、放置ルームの確認の予約のしかた
- 2026-11-01 文書との食い違いを修正：`player:self`・`host:participants`・`host:codes` の送るきっかけと中身を実装に合わせた。放置ルームの削除予定の扱い（5-2）を 5-3 に合わせた
