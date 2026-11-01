import { Agent, callable } from "agents";

/** ルーム一覧を持つ Agent（インスタンスは1つ）。名前は固定（api.md 4-3） */
export const ROOM_DIRECTORY_NAME = "main";

/**
 * Phase 2 では疎通確認用の最小構成。合言葉の確認や一覧は Phase 5 で実装する。
 */
export class RoomDirectory extends Agent<Cloudflare.Env> {
  /** 疎通確認用（秘密の値を返さない）。Phase 5 で見直す */
  @callable()
  ping(): { ok: true; now: number } {
    return { ok: true, now: Date.now() };
  }
}
