"use client";

// BingoRoom への接続（画面で共有する）。docs/design/api.md
import { useEffect, useRef, useState } from "react";
import { useAgent } from "agents/react";
import type { BingoRoom } from "@/agents/bingo-room";
import type { RoomPublicState, ServerMessage } from "@/agents/types";

/** 接続が終わった理由（サーバーが知らせてから切る。自動では再接続しない。api.md 3-1） */
export type EndReason = "not-found" | "deleted" | "removed" | "code-replaced" | "token-changed";

const END_MESSAGES: Partial<Record<ServerMessage["type"], EndReason>> = {
  "room:not-found": "not-found",
  "room:deleted": "deleted",
  "player:removed": "removed",
  "player:code-replaced": "code-replaced",
  "host:token-changed": "token-changed",
};

export type RoomAgent = ReturnType<typeof useAgent<BingoRoom, RoomPublicState>>;

type Options = {
  /** つながるたびに呼ぶ（名乗り直す。役割は接続ごとなので、再接続したら名乗り直す） */
  onOpen?: (agent: RoomAgent) => void;
  /** 個別メッセージ（player:self・host:participants など） */
  onMessage?: (message: ServerMessage) => void;
  /** サーバーから公開 state が届いたとき（演出のきっかけに使う） */
  onState?: (state: RoomPublicState) => void;
};

export function useBingoRoom(roomId: string, options: Options = {}) {
  const [state, setState] = useState<RoomPublicState | null>(null);
  const [connected, setConnected] = useState(false);
  const [ended, setEnded] = useState<EndReason | null>(null);
  const optionsRef = useRef(options);
  const agentRef = useRef<RoomAgent | null>(null);
  useEffect(() => {
    optionsRef.current = options;
  });

  const agent = useAgent<BingoRoom, RoomPublicState>({
    agent: "BingoRoom",
    name: roomId,
    // 表示にはサーバーから届いた state だけを使う（api.md 7章）。初期化前の空の state は使わない
    onStateUpdate: (s, source) => {
      if (source !== "server" || !s.roomId) return;
      setState(s);
      optionsRef.current.onState?.(s);
    },
    onOpen: () => {
      setConnected(true);
      if (agentRef.current) optionsRef.current.onOpen?.(agentRef.current);
    },
    onClose: () => setConnected(false),
    onMessage: (event) => {
      if (typeof event.data !== "string") return;
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      const reason = END_MESSAGES[message.type];
      if (reason) setEnded(reason);
      optionsRef.current.onMessage?.(message);
    },
  });
  useEffect(() => {
    agentRef.current = agent;
  });

  return { agent, state, connected, ended };
}

/** 終わった理由ごとの文（screens.md 2章・6-2） */
export const END_TEXT: Record<EndReason, string> = {
  "not-found": "このルームは見つかりません（終了し、削除された可能性があります）",
  deleted: "このルームは削除されました",
  removed: "司会によって参加が取り消されました",
  "code-replaced": "このコードは使えなくなりました。受付で新しいコードを受け取ってください",
  "token-changed": "司会用 URL が変更されました。管理画面から新しい URL を開いてください",
};
