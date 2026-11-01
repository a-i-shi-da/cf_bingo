import { PrintSheet } from "./print-sheet";

// S-03 参加コード印刷（docs/design/screens.md 5章）
export default async function PrintPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <PrintSheet roomId={roomId} />;
}
