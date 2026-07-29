import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { parseReleaseNotesMarkdown, type ProductRelease } from "@/lib/releaseNotes";

export async function loadReleaseNotes(): Promise<ProductRelease[]> {
  const markdown = await readFile(path.join(process.cwd(), "RELEASES.md"), "utf8");
  return parseReleaseNotesMarkdown(markdown);
}
