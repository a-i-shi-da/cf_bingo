import { Agent, callable, type Connection } from "agents";
import type { RoomPublicState } from "./types";

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
    startedAt: null,
    finishedAt: null,
    deleteAt: null,
  };

  /** 公開 state はサーバーだけが変えられる（クライアントからの setState を拒否する） */
  validateStateChange(_next: RoomPublicState, source: Connection | "server") {
    if (source !== "server") {
      throw new Error("FORBIDDEN");
    }
  }

  /** 疎通確認用（秘密の値を返さない）。Phase 4 で見直す */
  @callable()
  ping(): { ok: true; name: string; now: number } {
    return { ok: true, name: this.name, now: Date.now() };
  }
}
