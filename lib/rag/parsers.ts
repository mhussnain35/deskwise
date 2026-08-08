/**
 * Upload parsing — turns a user's file into plain text the chunker can work on.
 *
 * Everything here runs on the Node.js runtime (the PDF and DOCX readers need
 * Buffer/stream APIs the edge runtime doesn't provide), so any route importing
 * this module must declare `export const runtime = "nodejs"`.
 */

export type SupportedExtension =
  | ".md"
  | ".markdown"
  | ".txt"
  | ".pdf"
  | ".docx"
  | ".csv"
  | ".json"
  | ".html"
  | ".htm";

export const SUPPORTED_EXTENSIONS: SupportedExtension[] = [
  ".md",
  ".markdown",
  ".txt",
  ".pdf",
  ".docx",
  ".csv",
  ".json",
  ".html",
  ".htm",
];

/** Human-readable list for UI copy and error messages. */
export const SUPPORTED_LABEL = "PDF, DOCX, Markdown, TXT, CSV, JSON or HTML";

/** Accept attribute for <input type="file">. */
export const UPLOAD_ACCEPT =
  ".pdf,.docx,.md,.markdown,.txt,.csv,.json,.html,.htm,application/pdf,text/markdown,text/plain,text/csv,application/json,text/html";

/**
 * Content-Type → extension, for links whose URL carries no file extension
 * (`/export?format=pdf`, a docs page, a raw content endpoint).
 */
const CONTENT_TYPE_EXTENSIONS: Record<string, SupportedExtension> = {
  "application/pdf": ".pdf",
  "application/x-pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "text/markdown": ".md",
  "text/x-markdown": ".md",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/csv": ".csv",
  "application/json": ".json",
  "text/json": ".json",
  "text/html": ".html",
  "application/xhtml+xml": ".html",
};

/** Extension implied by a Content-Type header, or "" when unrecognised. */
export function extensionForContentType(contentType: string): string {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXTENSIONS[mime] || "";
}

export interface ParsedDocument {
  /** Full extracted text. */
  text: string;
  /** Optional page/sheet boundaries, used to label chunks (e.g. "Page 3"). */
  segments?: { label: string; text: string }[];
  /** Normalised extension, e.g. ".pdf". */
  extension: SupportedExtension;
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFileError";
  }
}

export function extensionOf(filename: string): string {
  const match = /\.[a-z0-9]+$/i.exec(filename.trim());
  return match ? match[0].toLowerCase() : "";
}

export function isSupportedFile(filename: string): boolean {
  return SUPPORTED_EXTENSIONS.includes(extensionOf(filename) as SupportedExtension);
}

/**
 * Extract text from an uploaded file.
 *
 * Throws UnsupportedFileError for anything outside the allowlist, and a plain
 * Error when a supported format turns out to be unreadable (corrupt file,
 * scanned PDF with no text layer, password-protected DOCX).
 */
export async function parseDocument(
  filename: string,
  buffer: Buffer
): Promise<ParsedDocument> {
  const extension = extensionOf(filename) as SupportedExtension;

  if (!SUPPORTED_EXTENSIONS.includes(extension)) {
    throw new UnsupportedFileError(
      `Unsupported file type "${extension || filename}". Upload a ${SUPPORTED_LABEL} file.`
    );
  }

  switch (extension) {
    case ".pdf":
      return { extension, ...(await parsePdf(buffer)) };
    case ".docx":
      return { extension, ...(await parseDocx(buffer)) };
    case ".csv":
      return { extension, text: normaliseWhitespace(csvToText(buffer.toString("utf-8"))) };
    case ".json":
      return { extension, text: normaliseWhitespace(jsonToText(buffer.toString("utf-8"))) };
    case ".html":
    case ".htm":
      return { extension, text: normaliseWhitespace(htmlToText(buffer.toString("utf-8"))) };
    default:
      // .md / .markdown / .txt — already plain text.
      return { extension, text: normaliseWhitespace(buffer.toString("utf-8")) };
  }
}

async function parsePdf(buffer: Buffer): Promise<{ text: string; segments: { label: string; text: string }[] }> {
  const { extractText, getDocumentProxy } = await import("unpdf");

  let pages: string[];
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: false });
    pages = (Array.isArray(result.text) ? result.text : [String(result.text)]).map(normaliseWhitespace);
  } catch (err) {
    console.error("[Parsers] PDF extraction failed:", err);
    throw new Error(
      "This PDF could not be read. It may be encrypted or corrupted — try re-exporting it."
    );
  }

  const segments = pages
    .map((text, idx) => ({ label: `Page ${idx + 1}`, text }))
    .filter((p) => p.text.length > 0);

  if (segments.length === 0) {
    throw new Error(
      "No selectable text was found in this PDF. Scanned or image-only PDFs need OCR before they can be searched."
    );
  }

  return { text: segments.map((s) => s.text).join("\n\n"), segments };
}

async function parseDocx(buffer: Buffer): Promise<{ text: string }> {
  const mammoth = await import("mammoth");

  try {
    // extractRawText keeps paragraph breaks, which is all the chunker needs.
    const { value } = await mammoth.extractRawText({ buffer });
    const text = normaliseWhitespace(value);
    if (!text) throw new Error("empty");
    return { text };
  } catch (err) {
    console.error("[Parsers] DOCX extraction failed:", err);
    throw new Error(
      "This Word document could not be read. Save it as .docx (not .doc) and try again."
    );
  }
}

/**
 * Render CSV as one labelled line per row ("Column: value · Column: value"),
 * so a retrieved chunk still says what each number means instead of arriving as
 * a bare comma-separated string with the header row lost several chunks ago.
 */
function csvToText(raw: string): string {
  const rows = parseCsvRows(raw);
  if (rows.length === 0) return "";

  const [header, ...body] = rows;
  if (body.length === 0) return rows.map((r) => r.join(", ")).join("\n");

  return body
    .map((row) =>
      row
        .map((cell, i) => (cell.trim() ? `${(header[i] || `Column ${i + 1}`).trim()}: ${cell.trim()}` : ""))
        .filter(Boolean)
        .join(" · ")
    )
    .filter(Boolean)
    .join("\n");
}

/** Minimal RFC-4180 reader — handles quoted fields containing commas/newlines. */
function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (inQuotes) {
      if (char === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') inQuotes = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && raw[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }

  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);

  return rows;
}

/**
 * Reduce an HTML page to readable text.
 *
 * Deliberately a stripper, not a parser: script, style, nav and footer content
 * is dropped, block-level tags become line breaks so paragraph chunking still
 * has boundaries to work with, and entities are decoded. A page whose text only
 * appears after client-side rendering will come back near-empty, which the
 * caller reports as "not enough readable text" rather than indexing markup.
 */
function htmlToText(raw: string): string {
  const withoutNoise = raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

  const withBreaks = withoutNoise
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|blockquote|pre)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " · ");

  return decodeEntities(withBreaks.replace(/<[^>]+>/g, " "));
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity[1]?.toLowerCase() === "x"
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Flatten JSON into `path: value` lines so keys stay attached to their values. */
function jsonToText(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return raw; // Not valid JSON — index it as plain text rather than failing.
  }

  const lines: string[] = [];

  const walk = (value: unknown, path: string) => {
    if (value === null || typeof value !== "object") {
      lines.push(`${path || "value"}: ${String(value)}`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      walk(child, path ? `${path}.${key}` : key);
    }
  };

  walk(parsed, "");
  return lines.join("\n");
}

/**
 * Drop control characters, keeping tab and newline.
 *
 * PDF and DOCX extraction routinely emits form feeds, vertical tabs and stray
 * NULs. Left in place they travel straight into the model prompt and into the
 * JSON citation payload, where they break the header encoding.
 */
function stripControlChars(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    const isTabOrNewline = code === 9 || code === 10;
    const isControl = code < 32 || code === 127;
    if (isTabOrNewline || !isControl) out += char;
  }
  return out;
}

/** Normalise line endings, strip control characters, collapse runaway spacing. */
export function normaliseWhitespace(text: string): string {
  return stripControlChars(text.replace(/\r\n?/g, "\n"))
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

