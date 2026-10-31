# 設計判断の記録（ADR）

ファイル名は `NNNN-タイトル.md`。書く項目は「背景 / 決定 / 理由 / 影響」。判断を変えるときは、元の ADR を書き換えずに新しい ADR を作り、元の状態を「置き換え（NNNN）」にする。

| 番号 | 題名 | 状態 |
|---|---|---|
| [0001](0001-single-worker-opennext-agents.md) | OpenNext と Agents SDK を1つの Worker に同居させる | 採用 |
| [0002](0002-server-side-judgement.md) | リーチ・ビンゴの判定をサーバー側で行う | 採用 |
| [0003](0003-passphrase-and-host-token-before-clerk.md) | MVP は合言葉と司会トークンで守り、次期に Clerk へ移行する | 採用 |
| [0004](0004-room-directory-as-agent.md) | ルーム一覧を、1つだけの Agent（RoomDirectory）で持つ | 採用 |
| [0005](0005-join-code-as-identity.md) | 参加コードを、参加者の身元と復帰の鍵にする | 採用 |
