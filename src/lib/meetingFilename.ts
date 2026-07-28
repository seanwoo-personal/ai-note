const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]+/gu;
const UNSAFE_FILENAME_CHARACTERS = /[\\/?%*:|"<>]+/gu;

function sanitizeFilenamePart(value: string): string {
  return value
    .replace(CONTROL_CHARACTERS, " ")
    .replace(UNSAFE_FILENAME_CHARACTERS, "_")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/gu, "")
    .slice(0, 160);
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

export function contentDispositionForMeeting(input: {
  title: string;
  fallbackId: string;
  extension: string;
}): string {
  const extension = input.extension.replace(/[^A-Za-z0-9]/gu, "").toLowerCase() || "txt";
  const fallback = input.fallbackId.replace(/[^A-Za-z0-9_-]/gu, "_").slice(0, 80) || "meeting";
  const title = sanitizeFilenamePart(input.title) || fallback;
  const unicodeFilename = `${title}.${extension}`;
  return `attachment; filename="${fallback}.${extension}"; filename*=UTF-8''${encodeRfc5987(unicodeFilename)}`;
}
