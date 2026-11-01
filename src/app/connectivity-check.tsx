"use client";

import { useState } from "react";
import { useAgent } from "agents/react";
import { Button } from "@/components/ui/button";
import type { BingoRoom } from "@/agents/bingo-room";
import type { RoomPublicState } from "@/agents/types";

const TEST_ROOM = "phase2-test-room";

export function ConnectivityCheck() {
  const [state, setState] = useState<RoomPublicState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const add = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev]);

  const room = useAgent<BingoRoom, RoomPublicState>({
    agent: "BingoRoom",
    name: TEST_ROOM,
    // 表示にはサーバーから届いた state だけを使う。
    // クライアントの setState は送ると同時に "client" として呼ばれ、拒否されても戻らないため
    onStateUpdate: (s, source) => {
      if (source === "server") setState(s);
    },
    onStateUpdateError: (error) => add(`state の書き換えを拒否されました：${error}`),
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
  });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      add(`${label} → ${JSON.stringify(await fn())}`);
    } catch (e) {
      add(`${label} ✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="space-y-4">
      <p>
        BingoRoom（{TEST_ROOM}）：
        <strong>{connected ? "接続中" : "未接続"}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => run("ping", () => room.stub.ping())}>
          ping
        </Button>
        <Button variant="outline"
          onClick={() =>
            run("client setState（拒否されるはず）", async () => {
              room.setState({ ...(state as RoomPublicState), name: "hacked" });
              return "sent";
            })
          }
        >
          クライアントから setState
        </Button>
      </div>
      <section>
        <h2 className="font-bold">公開 state</h2>
        <pre className="overflow-x-auto rounded bg-muted p-2 text-sm">
          {state ? JSON.stringify(state, null, 2) : "（未受信）"}
        </pre>
      </section>
      <section>
        <h2 className="font-bold">ログ</h2>
        <pre className="overflow-x-auto rounded bg-muted p-2 text-sm">{log.join("\n")}</pre>
      </section>
    </div>
  );
}
