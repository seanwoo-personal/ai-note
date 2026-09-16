import { RoomCreateClient } from "@/components/RoomCreateClient";

// Host entry for the shared interpreter room (ADR 0028). Static shell; the
// room is created through app-api on submit.
export default function RoomsPage() {
  return <RoomCreateClient />;
}
