import { GuestJoinClient } from "@/components/GuestJoinClient";

export const dynamic = "force-dynamic";

// Public join page. The token only names an invite; entry still needs the
// password and a name (ADR 0028 §4).
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <GuestJoinClient token={token} />;
}
