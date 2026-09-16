import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";

// Document renderers for interpreter-room downloads. Input is the same plain
// text the Markdown export uses (minutes body or bilingual transcript), so
// every format carries identical content: Markdown for tools, Word for
// editing, and a print stylesheet page the browser saves as PDF.

export interface RoomDocumentInput {
  title: string;
  /** Plain text: blank line between blocks, `- ` bullets, first line of a block may be a heading. */
  body: string;
  language: string;
  generatedAt: string;
}

interface Block {
  heading: string | null;
  lines: string[];
}

/** Split the plain-text body into blocks; a block's first non-bullet line acts as its heading. */
export function parseDocumentBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of body.replace(/\r\n/gu, "\n").split(/\n{2,}/u)) {
    const lines = chunk.split("\n").map((line) => line.trimEnd()).filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    const [first, ...rest] = lines;
    const headingLike = !first.startsWith("- ") && rest.length > 0 && first.length <= 40 && !/[.。!?]$/u.test(first);
    blocks.push(headingLike ? { heading: first, lines: rest } : { heading: null, lines });
  }
  return blocks;
}

function docxFont(language: string): string {
  if (language === "ja") return "Yu Gothic";
  if (language === "zh") return "Microsoft YaHei";
  if (language === "ko") return "Malgun Gothic";
  return "Calibri";
}

export async function renderRoomDocx(input: RoomDocumentInput): Promise<Buffer> {
  const font = docxFont(input.language);
  const run = (text: string, options: { bold?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text, font, size: options.size ?? 22, bold: options.bold, color: options.color });
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [run(input.title, { bold: true, size: 36 })] }),
    new Paragraph({ children: [run(input.generatedAt, { size: 18, color: "6B6158" })], spacing: { after: 240 } }),
  ];
  for (const block of parseDocumentBlocks(input.body)) {
    if (block.heading) {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 80 }, children: [run(block.heading, { bold: true, size: 26 })] }));
    }
    for (const line of block.lines) {
      if (line.startsWith("- ")) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: [run(line.slice(2))] }));
      } else {
        children.push(new Paragraph({ spacing: { after: 80 }, children: [run(line)] }));
      }
    }
  }
  const document = new Document({
    creator: "Vision AI 미팅 에이전트",
    title: input.title,
    styles: { default: { document: { run: { font, size: 22 } } } },
    sections: [{ children }],
  });
  return Packer.toBuffer(document);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

/**
 * Self-contained print page. The browser's print dialog produces the PDF, so
 * fonts and CJK line breaking come from the viewer's system — no font bundle.
 */
export function renderRoomPrintHtml(input: RoomDocumentInput, labels: { printHint: string }): string {
  const blocks = parseDocumentBlocks(input.body).map((block) => {
    const heading = block.heading ? `<h2>${escapeHtml(block.heading)}</h2>` : "";
    const bullets = block.lines.filter((line) => line.startsWith("- "));
    const paragraphs = block.lines.filter((line) => !line.startsWith("- "));
    const list = bullets.length > 0 ? `<ul>${bullets.map((line) => `<li>${escapeHtml(line.slice(2))}</li>`).join("")}</ul>` : "";
    const text = paragraphs.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
    return `<section>${heading}${text}${list}</section>`;
  }).join("");
  return `<!doctype html>
<html lang="${escapeHtml(input.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 32px 24px; background: #FAF8F4; color: #2A2420; font-family: "Noto Sans KR", "Noto Sans JP", "Hiragino Sans", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif; line-height: 1.7; word-break: keep-all; overflow-wrap: anywhere; }
  main { max-width: 72ch; margin: 0 auto; background: #FFFFFF; border: 1px solid #E8E1D7; border-radius: 12px; padding: 40px 36px; }
  h1 { font-size: 24px; margin: 0 0 4px; letter-spacing: -.01em; }
  h2 { font-size: 16px; margin: 24px 0 6px; }
  p { margin: 0 0 8px; font-size: 14px; }
  ul { margin: 0 0 8px; padding-left: 20px; font-size: 14px; }
  li { margin: 2px 0; }
  .meta { color: #6B6158; font-size: 12px; margin-bottom: 20px; }
  .toolbar { max-width: 72ch; margin: 0 auto 16px; display: flex; justify-content: flex-end; gap: 8px; }
  .toolbar button { min-height: 44px; padding: 0 16px; border-radius: 8px; border: 1px solid #E8E1D7; background: #5B4A42; color: #FAF8F4; font: inherit; font-weight: 700; cursor: pointer; }
  @media print { body { background: #FFFFFF; padding: 0; } main { border: 0; padding: 0; } .toolbar { display: none; } }
</style>
</head>
<body>
<div class="toolbar"><button type="button" onclick="window.print()">${escapeHtml(labels.printHint)}</button></div>
<main>
<h1>${escapeHtml(input.title)}</h1>
<p class="meta">${escapeHtml(input.generatedAt)}</p>
${blocks}
</main>
</body>
</html>
`;
}
