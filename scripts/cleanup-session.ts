import "./load-env";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { conversations, docs, tickets } from "../lib/db/schema";

/**
 * Remove everything belonging to one chat session — uploaded documents and
 * their chunks, the conversation and its messages, and any escalation tickets.
 *
 *   npx tsx scripts/cleanup-session.ts session_abc123
 *
 * Useful after a demo or a test run; message and chunk rows are removed by the
 * foreign-key cascades rather than deleted here.
 */
async function main() {
  const sessionId = process.argv[2];

  if (!sessionId) {
    console.error("Usage: npx tsx scripts/cleanup-session.ts <sessionId>");
    process.exit(1);
  }

  if (!db) {
    console.error("DATABASE_URL is not configured.");
    process.exit(1);
  }

  const removedDocs = await db
    .delete(docs)
    .where(and(eq(docs.scope, "user"), eq(docs.sessionId, sessionId)))
    .returning({ id: docs.id });

  const removedTickets = await db
    .delete(tickets)
    .where(eq(tickets.sessionId, sessionId))
    .returning({ id: tickets.id });

  const removedConversations = await db
    .delete(conversations)
    .where(eq(conversations.sessionId, sessionId))
    .returning({ id: conversations.id });

  console.log(`🧹 Cleaned session "${sessionId}"`);
  console.log(`   documents:     ${removedDocs.length}`);
  console.log(`   tickets:       ${removedTickets.length}`);
  console.log(`   conversations: ${removedConversations.length} (messages cascade)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
