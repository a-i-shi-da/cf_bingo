import { exports } from "cloudflare:workers";

type Frame = { type: string; [key: string]: unknown };

/**
 * Agent に WebSocket でつなぐテスト用のクライアント。
 * 届いたフレームを貯めておき、条件に合うものを待てる。
 */
export async function connectAgent(agent: string, name: string) {
  const res = await exports.default.fetch(`http://example.com/agents/${agent}/${name}`, {
    headers: { Upgrade: "websocket" },
  });
  const ws = res.webSocket;
  if (!ws) throw new Error(`WebSocket upgrade failed: ${res.status}`);
  ws.accept();

  const frames: Frame[] = [];
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
  });
  const waiters: { match: (f: Frame) => boolean; resolve: (f: Frame) => void }[] = [];
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const frame = JSON.parse(event.data) as Frame;
    frames.push(frame);
    for (const w of [...waiters]) {
      if (w.match(frame)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(frame);
      }
    }
  });

  const waitFor = (match: (f: Frame) => boolean, timeoutMs = 2000) =>
    new Promise<Frame>((resolve, reject) => {
      const found = frames.find(match);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error("timeout waiting for frame")), timeoutMs);
      waiters.push({
        match,
        resolve: (f) => {
          clearTimeout(timer);
          resolve(f);
        },
      });
    });

  let seq = 0;
  const call = async (method: string, ...args: unknown[]) => {
    const id = `t${++seq}`;
    ws.send(JSON.stringify({ type: "rpc", id, method, args }));
    const reply = await waitFor((f) => f.type === "rpc" && f.id === id);
    if (!reply.success) throw new Error(String(reply.error));
    return reply.result;
  };

  /** 届いた個別メッセージ（type で絞る） */
  const messages = (type: string) => frames.filter((f) => f.type === type);

  return { ws, frames, waitFor, call, messages, closed, close: () => ws.close() };
}
