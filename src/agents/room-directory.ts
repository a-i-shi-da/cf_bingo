import { Agent, callable } from "agents";
import type { RoomChange } from "./types";

/** ルーム一覧を持つ Agent（インスタンスは1つ）。名前は固定（api.md 4-3） */
export const ROOM_DIRECTORY_NAME = "main";

/**
 * 合言葉の確認や一覧は Phase 5 で実装する。
 */
export class RoomDirectory extends Agent<Cloudflare.Env> {
  /** 疎通確認用（秘密の値を返さない）。Phase 5 で見直す */
  @callable()
  ping(): { ok: true; now: number } {
    return { ok: true, now: Date.now() };
  }

  /** BingoRoom の状態が変わったとき（Agent どうしの呼び出し）。一覧の更新は Phase 5 で実装する */
  async roomChanged(_roomId: string, _change: RoomChange): Promise<void> {}

  /** BingoRoom が自動削除されたとき（Agent どうしの呼び出し）。一覧からの削除は Phase 5 で実装する */
  async roomDeleted(_roomId: string): Promise<void> {}
}
