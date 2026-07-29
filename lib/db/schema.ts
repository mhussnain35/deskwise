import { pgTable, uuid, text, varchar, timestamp, jsonb } from "drizzle-orm/pg-core";

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

export const docs = pgTable("docs", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  sourceUrl: text("source_url"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

export const docChunks = pgTable("doc_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  docId: uuid("doc_id")
    .references(() => docs.id, { onDelete: "cascade" })
    .notNull(),
  content: text("content").notNull(),
  section: text("section"),
  qdrantPointId: text("qdrant_point_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const feedback = pgTable("feedback", {
  id: uuid("id").defaultRandom().primaryKey(),
  messageId: uuid("message_id")
    .references(() => messages.id, { onDelete: "cascade" })
    .notNull(),
  rating: varchar("rating", { length: 10 }).notNull(), // 'up' | 'down'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
