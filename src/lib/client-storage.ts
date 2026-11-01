// ブラウザ側の保存と URL の秘密の値（docs/design/security.md 3章）

/**
 * ページ URL のクエリ（?t= ?c=）を読み取り、すぐアドレスバーから消す。
 * 司会画面を投影したり URL を共有したりしたときに、秘密の値が漏れないようにするため
 */
export function takeUrlParam(name: string): string | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  if (value !== null) {
    url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }
  return value;
}

function safeGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // 保存できない環境（プライベートモードなど）でも、開いている間は使える
  }
}

const session = () => window.sessionStorage;
const local = () => window.localStorage;

/** 司会トークン：タブの中だけ（sessionStorage）。タブを閉じたら消える */
export const hostTokenStore = {
  get: (roomId: string) => safeGet(session, `bingo:host:${roomId}`),
  set: (roomId: string, token: string | null) => safeSet(session, `bingo:host:${roomId}`, token),
};

/** 参加コード：ブラウザ（localStorage）にルームごとに保存する（開き直したときの復帰。domain-model 3章） */
export const joinCodeStore = {
  get: (roomId: string) => safeGet(local, `bingo:code:${roomId}`),
  set: (roomId: string, code: string | null) => safeSet(local, `bingo:code:${roomId}`, code),
};

/** ビンゴのお祝い表示を閉じたか（開き直したときに何度も出さない） */
export const celebratedStore = {
  get: (roomId: string) => safeGet(local, `bingo:celebrated:${roomId}`) === "1",
  set: (roomId: string) => safeSet(local, `bingo:celebrated:${roomId}`, "1"),
};
