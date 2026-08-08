import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations, messages, docChunks } from "@/lib/db/schema";
import { eq, asc, inArray, or } from "drizzle-orm";
import { isValidSessionId } from "@/lib/session";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  let sessionId = "";
  try {
    const resolvedParams = await params;
    sessionId = resolvedParams?.sessionId || "";

    if (!isValidSessionId(sessionId)) {
      return NextResponse.json({ error: "A valid session ID is required" }, { status: 400 });
    }

    if (!db) {
      return NextResponse.json({ sessionId, messages: [] });
    }

    try {
      // 1. Find conversation by sessionId
      const convRows = await db
        .select()
        .from(conversations)
        .where(eq(conversations.sessionId, sessionId))
        .limit(1);

      if (convRows.length === 0) {
        return NextResponse.json({ sessionId, messages: [] });
      }

      const conversationId = convRows[0].id;

      // 2. Fetch associated messages
      const messageRows = await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt));

      // 3. Collect all cited chunk IDs to load metadata
      const allCitedChunkIds: string[] = [];
      messageRows.forEach((m) => {
        if (Array.isArray(m.citedChunkIds)) {
          allCitedChunkIds.push(...m.citedChunkIds);
        }
      });

      type HistoryCitation = {
        id: string;
        title: string;
        section: string;
        content: string;
        scope: "kb" | "user";
      };
      const chunkMap: Record<string, HistoryCitation> = {};

      if (allCitedChunkIds.length > 0) {
        try {
          // Knowledge base chunks are cited by their Qdrant point id; chunks
          // from a user's own upload never reach Qdrant and are cited by their
          // doc_chunks primary key. Both forms are resolved in one pass.
          const uuidCitedIds = allCitedChunkIds.filter((id) => UUID_PATTERN.test(id));

          const fetchedChunks = await db
            .select()
            .from(docChunks)
            .where(
              uuidCitedIds.length > 0
                ? or(
                    inArray(docChunks.qdrantPointId, allCitedChunkIds),
                    inArray(docChunks.id, uuidCitedIds)
                  )
                : inArray(docChunks.qdrantPointId, allCitedChunkIds)
            );

          fetchedChunks.forEach((c) => {
            const citation: HistoryCitation = {
              id: c.qdrantPointId || c.id,
              title: c.title || "Document",
              section: c.section || "",
              content: c.content,
              scope: c.scope === "user" ? "user" : "kb",
            };
            if (c.qdrantPointId) chunkMap[c.qdrantPointId] = citation;
            chunkMap[c.id] = citation;
          });
        } catch (chunkErr) {
          console.warn("[History API] Error fetching chunk metadata:", chunkErr);
        }
      }

      // 4. Map message history payload
      const formattedMessages = messageRows.map((m) => {
        const citations = Array.isArray(m.citedChunkIds)
          ? m.citedChunkIds.map(
              (id) =>
                chunkMap[id] || {
                  id,
                  title: "Source Document",
                  section: "",
                  content: "",
                  scope: "kb" as const,
                }
            )
          : [];

        return {
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          citations: citations.length > 0 ? citations : undefined,
          createdAt: m.createdAt,
        };
      });

      return NextResponse.json({
        sessionId,
        conversationId,
        messages: formattedMessages,
      });
    } catch (dbQueryErr) {
      console.warn("[History API] DB query fallback:", dbQueryErr);
      return NextResponse.json({ sessionId, messages: [] });
    }
  } catch (error) {
    console.error("[History API] Unexpected error:", error);
    return NextResponse.json({ sessionId, messages: [] });
  }
}
