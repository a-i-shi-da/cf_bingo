import { ProjectorScreen } from "./projector-screen";

// S-05 投影（docs/design/screens.md 7章）
export default async function ScreenPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <ProjectorScreen roomId={roomId} />;
}
