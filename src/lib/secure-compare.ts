// 秘密の値（司会トークン・合言葉）の比較。比べる時間で中身が推測されないようにする（security.md 2-2）

const encoder = new TextEncoder();

/** a と b が等しいか。長さが違っても、比べる時間はほぼ同じ */
export function secureEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  // 長さが違うときも同じ量の比較をしてから false を返す
  const subtle = crypto.subtle as SubtleCrypto & { timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean };
  if (x.byteLength !== y.byteLength) {
    if (subtle.timingSafeEqual) subtle.timingSafeEqual(x, x);
    return false;
  }
  if (subtle.timingSafeEqual) return subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.byteLength; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
