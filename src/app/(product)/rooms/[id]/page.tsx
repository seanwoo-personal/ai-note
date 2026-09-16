import { notFound } from "next/navigation";

import { InterpreterRoom } from "@/components/InterpreterRoom";
import { isSafeId } from "@/lib/meetingId";

export const dynamic = "force-dynamic";

// Host view of a shared interpreter room. Data is read by the client through
// the room API (session-scoped), so this shell reads nothing at build time.
export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isSafeId(id)) notFound();
  return <InterpreterRoom roomId={id} role="host" />;
}
