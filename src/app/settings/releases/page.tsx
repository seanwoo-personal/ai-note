import { ReleaseNotes } from "@/components/ReleaseNotes";
import { loadReleaseNotes } from "@/lib/releaseNotes.server";

export const dynamic = "force-dynamic";

export default async function ReleaseNotesPage() {
  const releases = await loadReleaseNotes();
  return (
    <main id="main" className="max-w-3xl px-4 py-12 sm:px-6">
      <ReleaseNotes releases={releases} />
    </main>
  );
}
