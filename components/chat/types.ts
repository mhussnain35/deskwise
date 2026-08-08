export interface Citation {
  id: string;
  title: string;
  section: string;
  content: string;
  /** Dense cosine similarity, 0..1. */
  score?: number;
  /** Normalised BM25 score from the keyword arm, 0..1. */
  keywordScore?: number;
  /** 'user' when the source is a document this visitor uploaded. */
  scope?: "kb" | "user";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  citations?: Citation[];
  /** Set when the turn failed, so the bubble can be styled as an error. */
  failed?: boolean;
}

export interface UserDocument {
  id: string;
  title: string;
  filename: string;
  fileType: string;
  sizeBytes: number;
  chunkCount: number;
  uploadedAt: string;
}

export interface UploadLimits {
  maxDocs: number;
  maxFileMb: number;
  retentionDays: number;
}
