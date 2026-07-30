import { Suspense } from "react";

import { SonioxWorkspaceClient } from "@/components/SonioxWorkspaceClient";

export default function SonioxPage() {
  return (
    <Suspense fallback={<main id="main" className="px-6 py-12 text-[14px] text-inkSoft">실시간 작업 영역을 불러오는 중…</main>}>
      <SonioxWorkspaceClient />
    </Suspense>
  );
}
