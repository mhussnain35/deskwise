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
