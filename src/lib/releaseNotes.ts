export type ProductRelease = {
  version: string;
  date: string;
  title: string;
  changes: string[];
};

const VERSION = /^##\s+(\d+\.\d+\.\d+)\s*$/;
const METADATA = /^\*\*(\d{4}-\d{2}-\d{2})\s+·\s+(.+?)\*\*\s*$/;

export function parseReleaseNotesMarkdown(markdown: string): ProductRelease[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const releases: ProductRelease[] = [];
  const versions = new Set<string>();
  let index = 0;

  while (index < lines.length) {
    const versionMatch = lines[index].match(VERSION);
    if (!versionMatch) {
      index += 1;
      continue;
    }
    const version = versionMatch[1];
    if (versions.has(version)) throw new Error(`duplicate release version: ${version}`);
    versions.add(version);
    index += 1;
    while (index < lines.length && !lines[index].trim()) index += 1;
    const metadata = lines[index]?.match(METADATA);
    if (!metadata) throw new Error(`release metadata missing for ${version}`);
    index += 1;
    const changes: string[] = [];
    while (index < lines.length && !VERSION.test(lines[index])) {
      const item = lines[index].match(/^\s*-\s+(.+?)\s*$/);
      if (item) changes.push(item[1]);
      index += 1;
    }
    if (changes.length === 0) throw new Error(`release changes missing for ${version}`);
    releases.push({ version, date: metadata[1], title: metadata[2], changes });
  }

  if (releases.length === 0) throw new Error("release notes contain no releases");
  return releases;
}
