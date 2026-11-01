import { PlayerScreen } from "./player-screen";

// S-04 参加者（docs/design/screens.md 6章）
export default async function RoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <PlayerScreen roomId={roomId} />;
}
