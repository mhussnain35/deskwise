export interface Chunk {
  title: string;
  section: string;
  content: string;
  breadcrumbs: string[];
}

/**
 * Semantic Heading-Based Markdown Chunker
 * Splits a markdown document into meaningful chunks based on Heading 1 (#), Heading 2 (##), and Heading 3 (###),
 * preserving section context breadcrumbs for RAG retrieval accuracy.
 */
export function chunkMarkdown(filename: string, fileContent: string): Chunk[] {
  const lines = fileContent.split("\n");
  const chunks: Chunk[] = [];

  let mainTitle = filename.replace(/\.md$/, "").replace(/^[0-9]+-/, "").replace(/-/g, " ");
  let currentH1 = mainTitle;
  let currentH2 = "";
  let currentH3 = "";
  let currentBuffer: string[] = [];

  const flushBuffer = () => {
    const text = currentBuffer.join("\n").trim();
    if (text.length > 30) { // filter tiny empty fragments
      const breadcrumbs = [currentH1, currentH2, currentH3].filter(Boolean);
      const sectionName = breadcrumbs.slice(1).join(" > ") || currentH1;
      
      chunks.push({
        title: mainTitle,
        section: sectionName,
        content: text,
        breadcrumbs,
      });
    }
    currentBuffer = [];
  };

  for (const line of lines) {
    if (line.startsWith("# ")) {
      flushBuffer();
      currentH1 = line.replace("# ", "").trim();
      mainTitle = currentH1;
      currentH2 = "";
      currentH3 = "";
      currentBuffer.push(line);
    } else if (line.startsWith("## ")) {
      flushBuffer();
      currentH2 = line.replace("## ", "").trim();
      currentH3 = "";
      currentBuffer.push(line);
    } else if (line.startsWith("### ")) {
      flushBuffer();
      currentH3 = line.replace("### ", "").trim();
      currentBuffer.push(line);
    } else {
      currentBuffer.push(line);
    }
  }

  flushBuffer();
  return chunks;
}

// ---------------------------------------------------------------------------
// Plain-text chunking
//
// The heading chunker above only works on markdown the company wrote. Files a
// user uploads — PDFs, Word documents, exported notes — usually have no heading
// structure at all, and running them through chunkMarkdown yields exactly one
// enormous chunk that retrieval can't discriminate against. These documents are
// instead split on paragraph boundaries and packed up to a target size, with a
// small overlap so an answer that straddles a boundary is still retrievable.
// ---------------------------------------------------------------------------

const TARGET_CHUNK_CHARS = 1200;
const MAX_CHUNK_CHARS = 1800;
const OVERLAP_CHARS = 160;
const MIN_CHUNK_CHARS = 40;

export interface ChunkTextOptions {
  /** Label for the region this text came from, e.g. "Page 4". */
  sectionLabel?: string;
  /** Chunk numbering offset, so multi-page documents number continuously. */
  startIndex?: number;
}

/** Split text into overlapping, paragraph-aligned chunks. */
export function chunkPlainText(
  title: string,
  text: string,
  options: ChunkTextOptions = {}
): Chunk[] {
  const { sectionLabel, startIndex = 0 } = options;
  const paragraphs = splitParagraphs(text);
  const chunks: Chunk[] = [];

  let buffer = "";

  const flush = () => {
    const content = buffer.trim();
    buffer = "";
    if (content.length < MIN_CHUNK_CHARS) return;

    const part = startIndex + chunks.length + 1;
    const section = sectionLabel ? `${sectionLabel} · Part ${part}` : `Part ${part}`;

    chunks.push({
      title,
      section,
      content,
      breadcrumbs: [title, section],
    });
  };

  for (const paragraph of paragraphs) {
    if (!paragraph) continue;

    if (buffer && buffer.length + paragraph.length + 1 > TARGET_CHUNK_CHARS) {
      const carry = tailOverlap(buffer);
      flush();
      buffer = carry;
    }

    buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;

    // A single paragraph can exceed the target on its own (dense PDF pages,
    // minified JSON). Emit it in pieces rather than letting one chunk grow
    // past what the prompt budget can carry.
    while (buffer.length > MAX_CHUNK_CHARS) {
      const cut = breakPoint(buffer, TARGET_CHUNK_CHARS);
      const head = buffer.slice(0, cut);
      const rest = buffer.slice(cut);
      buffer = head;
      const carry = tailOverlap(head);
      flush();
      buffer = (carry + rest).trim();
    }
  }

  flush();
  return chunks;
}

export interface DocumentToChunk {
  filename: string;
  title: string;
  text: string;
  /** Page-level segments from a PDF, when available. */
  segments?: { label: string; text: string }[];
}

/**
 * Pick the right chunking strategy for a document: heading-based when the file
 * genuinely has markdown structure, page-aware plain text for PDFs, paragraph
 * packing for everything else.
 */
export function chunkDocument({ filename, title, text, segments }: DocumentToChunk): Chunk[] {
  const isMarkdown = /\.(md|markdown)$/i.test(filename);
  const hasHeadings = /^#{1,3} \S/m.test(text);

  if (isMarkdown && hasHeadings) {
    return chunkMarkdown(filename, text).map((chunk) => ({ ...chunk, title }));
  }

  if (segments && segments.length > 0) {
    const chunks: Chunk[] = [];
    for (const segment of segments) {
      chunks.push(
        ...chunkPlainText(title, segment.text, {
          sectionLabel: segment.label,
          startIndex: 0,
        })
      );
    }
    // Page-scoped numbering restarts per page, which is what a reader expects
    // ("Page 4 · Part 1"), so only fall back to the flat splitter when a
    // document produced no usable pages at all.
    if (chunks.length > 0) return chunks;
  }

  return chunkPlainText(title, text);
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .flatMap((block) => (block.length > MAX_CHUNK_CHARS ? block.split(/\n/) : [block]))
    .map((p) => p.trim())
    .filter(Boolean);
}

/** Last ~OVERLAP_CHARS of a chunk, trimmed to a sentence or word boundary. */
function tailOverlap(text: string): string {
  if (text.length <= OVERLAP_CHARS) return "";
  const tail = text.slice(-OVERLAP_CHARS);
  const sentenceStart = tail.search(/[.!?]\s+\S/);
  const sliced = sentenceStart >= 0 ? tail.slice(sentenceStart + 1) : tail.slice(tail.indexOf(" ") + 1);
  return sliced.trim();
}

/** Find a sentence/word boundary at or before `limit` so chunks don't split mid-word. */
function breakPoint(text: string, limit: number): number {
  const window = text.slice(0, limit);
  const lastSentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
  if (lastSentence > limit * 0.5) return lastSentence + 1;
  const lastSpace = window.lastIndexOf(" ");
  return lastSpace > limit * 0.5 ? lastSpace + 1 : limit;
}
