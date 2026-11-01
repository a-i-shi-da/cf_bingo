import { HostScreen } from "./host-screen";

// S-02 司会（docs/design/screens.md 4章）
export default async function HostPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <HostScreen roomId={roomId} />;
}
