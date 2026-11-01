import { ConnectivityCheck } from "./connectivity-check";

// Phase 2 の疎通確認ページ（管理画面 S-01 は Phase 5 で作る）
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-2xl font-bold">疎通確認（Phase 2）</h1>
      <ConnectivityCheck />
    </main>
  );
}
