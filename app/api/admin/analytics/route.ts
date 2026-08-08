import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { conversations, docs, feedback, messages, tickets } from "@/lib/db/schema";

export const runtime = "nodejs";

/**
 * GET /api/admin/analytics — usage summary for the admin dashboard.
 *
 * Read-only aggregates over data the app already writes, so it stays open like
 * the document listing; only the write endpoints are token-gated.
 */
export async function GET() {
  if (!db) {
    return NextResponse.json({
      available: false,
      message: "Analytics need a database connection. Set DATABASE_URL to enable them.",
    });
  }

  try {
    const [
      conversationCount,
      questionCount,
      ratings,
      openTickets,
      recentEscalations,
      topQuestions,
      uploads,
    ] = await Promise.all([
      db.select({ value: sql<number>`count(*)::int` }).from(conversations),

      db
        .select({ value: sql<number>`count(*)::int` })
        .from(messages)
        .where(eq(messages.role, "user")),

      db
        .select({ rating: feedback.rating, value: sql<number>`count(*)::int` })
        .from(feedback)
        .groupBy(feedback.rating),

      db.select({ value: sql<number>`count(*)::int` }).from(tickets),

      db
        .select({
          id: tickets.id,
          question: tickets.question,
          topScore: tickets.topScore,
          createdAt: tickets.createdAt,
        })
        .from(tickets)
        .orderBy(desc(tickets.createdAt))
        .limit(5),

      // Repeated questions are the signal for what the knowledge base is
      // missing, so they're grouped case-insensitively rather than verbatim.
      db
        .select({
          question: sql<string>`min(${messages.content})`,
          value: sql<number>`count(*)::int`,
        })
        .from(messages)
        .where(eq(messages.role, "user"))
        .groupBy(sql`lower(${messages.content})`)
        .orderBy(desc(sql`count(*)`))
        .limit(5),

      db
        .select({
          value: sql<number>`count(*)::int`,
          chunks: sql<number>`coalesce(sum(${docs.chunkCount}), 0)::int`,
        })
        .from(docs)
        .where(eq(docs.scope, "user")),
    ]);

    const thumbsUp = ratings.find((r) => r.rating === "up")?.value ?? 0;
    const thumbsDown = ratings.find((r) => r.rating === "down")?.value ?? 0;
    const totalRatings = thumbsUp + thumbsDown;

    return NextResponse.json({
      available: true,
      conversations: conversationCount[0]?.value ?? 0,
      questions: questionCount[0]?.value ?? 0,
      thumbsUp,
      thumbsDown,
      satisfactionRate: totalRatings > 0 ? thumbsUp / totalRatings : null,
      escalations: openTickets[0]?.value ?? 0,
      recentEscalations: recentEscalations.map((ticket) => ({
        id: ticket.id,
        question: ticket.question,
        topScore: ticket.topScore,
        createdAt: ticket.createdAt.toISOString(),
      })),
      topQuestions: topQuestions.map((row) => ({ question: row.question, count: row.value })),
      userUploads: {
        documents: uploads[0]?.value ?? 0,
        chunks: uploads[0]?.chunks ?? 0,
      },
    });
  } catch (error) {
    console.error("[Analytics API] Query failed:", error);
    return NextResponse.json(
      { available: false, message: "Could not load analytics." },
      { status: 500 }
    );
  }
}
