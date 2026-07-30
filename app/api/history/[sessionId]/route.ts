import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { conversations, messages, docChunks } from "@/lib/db/schema";
import { eq, asc, inArray } from "drizzle-orm";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  let sessionId = "";
  try {
    const resolvedParams = await params;
    sessionId = resolvedParams?.sessionId || "";

    if (!sessionId) {
      return NextResponse.json({ error: "Session ID is required" }, { status: 400 });
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

      const chunkMap: Record<string, { id: string; title: string; section: string; content: string }> = {};

      if (allCitedChunkIds.length > 0) {
        try {
          const fetchedChunks = await db
            .select()
            .from(docChunks)
            .where(inArray(docChunks.qdrantPointId, allCitedChunkIds));

          fetchedChunks.forEach((c) => {
            if (c.qdrantPointId) {
              chunkMap[c.qdrantPointId] = {
                id: c.qdrantPointId,
                title: "Document",
                section: c.section || "",
                content: c.content,
              };
            }
          });
        } catch (chunkErr) {
          console.warn("[History API] Error fetching chunk metadata:", chunkErr);
        }
      }

      // 4. Map message history payload
      const formattedMessages = messageRows.map((m) => {
        const citations = Array.isArray(m.citedChunkIds)
          ? m.citedChunkIds.map((id) => chunkMap[id] || { id, title: "Source Document", section: "", content: "" })
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
    } catch (dbQueryErr: any) {
      console.warn("[History API] DB query fallback:", dbQueryErr?.message || dbQueryErr);
      return NextResponse.json({ sessionId, messages: [] });
    }
  } catch (error: any) {
    console.error("[History API] Unexpected error:", error);
    return NextResponse.json({ sessionId, messages: [] });
  }
}
