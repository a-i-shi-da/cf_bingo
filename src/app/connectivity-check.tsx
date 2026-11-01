"use client";

import { useState } from "react";
import { useAgent } from "agents/react";
import type { BingoRoom } from "@/agents/bingo-room";
import type { RoomDirectory } from "@/agents/room-directory";
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
    onStateUpdate: (s) => setState(s),
    onOpen: () => setConnected(true),
    onClose: () => setConnected(false),
  });
  const directory = useAgent<RoomDirectory>({
    agent: "RoomDirectory",
    name: "main",
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
        <button className="rounded border px-3 py-1" onClick={() => run("ping", () => room.stub.ping())}>
          ping
        </button>
        <button className="rounded border px-3 py-1" onClick={() => run("whoami", () => room.stub.whoami())}>
          whoami
        </button>
        <button
          className="rounded border px-3 py-1"
          onClick={() => run("whoami(screen)", () => room.stub.whoami("screen"))}
        >
          役割を screen に
        </button>
        <button
          className="rounded border px-3 py-1"
          onClick={() => run("directory.pingRoom", () => directory.stub.pingRoom(TEST_ROOM))}
        >
          RoomDirectory → BingoRoom
        </button>
        <button
          className="rounded border px-3 py-1"
          onClick={() =>
            run("client setState（拒否されるはず）", async () => {
              room.setState({ ...(state as RoomPublicState), name: "hacked" });
              return "sent";
            })
          }
        >
          クライアントから setState
        </button>
      </div>
      <section>
        <h2 className="font-bold">公開 state</h2>
        <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-sm">
          {state ? JSON.stringify(state, null, 2) : "（未受信）"}
        </pre>
      </section>
      <section>
        <h2 className="font-bold">ログ</h2>
        <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-sm">{log.join("\n")}</pre>
      </section>
    </div>
  );
}
