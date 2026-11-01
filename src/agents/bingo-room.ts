import { Agent, callable, getCurrentAgent, type Connection } from "agents";
import type { ConnectionState, RoomPublicState } from "./types";

/**
 * 1ルーム = 1インスタンス（名前 = roomId）。
 * Phase 2 では疎通確認用の最小構成。ゲームの処理は Phase 4 で実装する。
 */
export class BingoRoom extends Agent<Cloudflare.Env, RoomPublicState> {
  initialState: RoomPublicState = {
    roomId: "",
    name: "",
    status: "waiting",
    drawn: [],
    lastDrawnAt: null,
    participantCount: 0,
    reachCount: 0,
    winners: [],
    finishedAt: null,
    deleteAt: null,
  };

  /** 公開 state はサーバーだけが変えられる（クライアントからの setState を拒否する） */
  validateStateChange(_next: RoomPublicState, source: Connection | "server") {
    if (source !== "server") {
      throw new Error("FORBIDDEN");
    }
  }

  // --- Phase 2：疎通確認用（Phase 4 で置き換える） ---

  @callable()
  ping(): { ok: true; name: string; now: number } {
    return { ok: true, name: this.name, now: Date.now() };
  }

  /** 呼んだ接続を取り出し、役割の読み書きができることを確かめる */
  @callable()
  whoami(setRole?: ConnectionState["role"]): {
    ok: true;
    connectionId: string;
    role: ConnectionState["role"];
  } {
    const { connection } = getCurrentAgent();
    if (!connection) throw new Error("NO_CONNECTION");
    const conn = connection as Connection<ConnectionState>;
    if (setRole) conn.setState({ role: setRole });
    return { ok: true, connectionId: conn.id, role: conn.state?.role ?? "guest" };
  }

  /** Agent どうしの呼び出し（RoomDirectory → BingoRoom）の確認用。DO RPC で呼ぶ */
  async rpcPing(from: string): Promise<{ ok: true; room: string; from: string }> {
    return { ok: true, room: this.name, from };
  }
}
