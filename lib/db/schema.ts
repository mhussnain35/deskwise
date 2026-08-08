import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  jsonb,
  integer,
  real,
  index,
} from "drizzle-orm/pg-core";

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  title: text("title"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id")
    .references(() => conversations.id, { onDelete: "cascade" })
    .notNull(),
  role: varchar("role", { length: 50 }).notNull(), // 'user' | 'assistant' | 'system'
  content: text("content").notNull(),
  citedChunkIds: jsonb("cited_chunk_ids").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * A knowledge base document.
 *
 * `scope` separates the two kinds of source material the agent can answer from:
 *   - 'kb'   — the company documentation shipped in /kb-docs, shared by everyone
 *   - 'user' — a file an end user uploaded to ask questions about, visible only
 *              to their own session
 */
export const docs = pgTable(
  "docs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    scope: varchar("scope", { length: 20 }).default("kb").notNull(),
    sessionId: varchar("session_id", { length: 255 }),
    filename: text("filename"),
    fileType: varchar("file_type", { length: 20 }),
    sizeBytes: integer("size_bytes"),
    chunkCount: integer("chunk_count").default(0).notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("docs_scope_session_idx").on(table.scope, table.sessionId)]
);

/**
 * A single retrievable section of a document.
 *
 * User-uploaded chunks carry their `embedding` inline. Serverless deployments
 * mount the app read-only, so uploads can't be written to /kb-docs and re-read
 * later — storing the vector next to the text is what makes an upload queryable
 * on the very next request, with or without Qdrant.
 */
export const docChunks = pgTable(
  "doc_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    docId: uuid("doc_id")
      .references(() => docs.id, { onDelete: "cascade" })
      .notNull(),
    title: text("title"),
    content: text("content").notNull(),
    section: text("section"),
    chunkIndex: integer("chunk_index").default(0).notNull(),
    scope: varchar("scope", { length: 20 }).default("kb").notNull(),
    sessionId: varchar("session_id", { length: 255 }),
    embedding: jsonb("embedding").$type<number[]>(),
    qdrantPointId: text("qdrant_point_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("doc_chunks_scope_session_idx").on(table.scope, table.sessionId)]
);

export const feedback = pgTable("feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id")
    .references(() => messages.id, { onDelete: "cascade" })
    .notNull(),
  rating: varchar("rating", { length: 10 }).notNull(), // 'up' | 'down'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Escalation ticket raised when retrieval confidence falls below threshold and
 * the agent hands off to a human instead of guessing (spec section 6).
 */
export const tickets = pgTable("tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: varchar("session_id", { length: 255 }).notNull(),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  question: text("question").notNull(),
  topScore: real("top_score"),
  status: varchar("status", { length: 20 }).default("open").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
