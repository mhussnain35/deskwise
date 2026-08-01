import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { ai, MODEL_NAME } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { retrieveContext, type RetrievedChunk } from "@/lib/rag/retriever";
import { checkRateLimit } from "@/lib/rate-limit";
import { UpstreamError, toUpstreamError, logUpstream } from "@/lib/errors";
import { eq } from "drizzle-orm";

// Citations ride on a response header, so they must stay well inside the ~4 KB
// per-header ceiling enforced by Vercel/AWS. Full chunk bodies used to be sent
// verbatim, which measured 4.3 KB worst-case against the current KB and grew
// unbounded with every admin upload. The UI only ever renders three clamped
// lines, so a snippet is all it needs.
const CITATION_SNIPPET_CHARS = 240;
const MAX_CITATIONS_HEADER_BYTES = 3000;

function buildCitationsHeader(chunks: RetrievedChunk[]): string {
  const citations = chunks.map((c) => ({
    id: c.id,
    title: c.title,
    section: c.section,
    content:
      c.content.length > CITATION_SNIPPET_CHARS
        ? c.content.slice(0, CITATION_SNIPPET_CHARS).trimEnd() + "…"
        : c.content,
    score: c.score,
  }));

  // Drop trailing citations rather than emit a header the platform will reject.
  while (citations.length > 1) {
    const encoded = encodeURIComponent(JSON.stringify(citations));
    if (encoded.length <= MAX_CITATIONS_HEADER_BYTES) return encoded;
    citations.pop();
  }

  return encodeURIComponent(JSON.stringify(citations));
}

async function saveAssistantMessage(
  conversationId: string,
  messageId: string,
  content: string,
  citedChunkIds?: string[]
): Promise<void> {
  if (!db) return;
  try {
    await db.insert(messages).values({
      id: messageId,
      conversationId,
      role: "assistant",
      content,
      citedChunkIds,
    });
  } catch (saveErr) {
    console.error("[Chat API] Error saving assistant response:", saveErr);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { message, sessionId } = await req.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const activeSessionId = sessionId || "default-session";

    // Phase 8 — Rate limiting: 10 req / 60s per session
    const rl = checkRateLimit(activeSessionId);
    if (!rl.allowed) {
      const retryAfter = Math.ceil(rl.resetMs / 1000);
      return NextResponse.json(
        {
          error: `You're sending messages too quickly. Please wait ${retryAfter} seconds before trying again.`,
          retryAfterMs: rl.resetMs,
        },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    let conversationId: string | null = null;

    // 1. Database Operations: Log or find active conversation turn
    if (db) {
      try {
        const existingConvs = await db
          .select()
          .from(conversations)
          .where(eq(conversations.sessionId, activeSessionId))
          .limit(1);

        if (existingConvs.length > 0) {
          conversationId = existingConvs[0].id;
        } else {
          const [newConv] = await db
            .insert(conversations)
            .values({
              sessionId: activeSessionId,
              title: message.slice(0, 50),
            })
            .returning();
          conversationId = newConv.id;
        }

        // Insert User Message
        await db.insert(messages).values({
          conversationId: conversationId,
          role: "user",
          content: message,
        });
      } catch (dbErr) {
        console.error("[Chat API] DB Error:", dbErr);
      }
    }

    // The assistant message id is minted up front so it can be returned in a
    // header before the body streams. The client needs a real database id to
    // submit feedback against — it used to invent `msg_<timestamp>`, which the
    // uuid-typed feedback.message_id column rejected on every single insert.
    const assistantMessageId = crypto.randomUUID();

    // 2. Perform RAG Retrieval against Knowledge Base
    const retrieval = await retrieveContext(message, 5);
    const encoder = new TextEncoder();

    // 3. Confidence Guardrail Check
    if (!retrieval.confidencePassed) {
      const fallbackMessage =
        "I'm sorry, I couldn't find a direct answer to that in our SaaS documentation.\n\n" +
        "Here is how you can get help:\n" +
        "• Contact our Human Support Team at **support@deskwise.io**\n" +
        "• Visit **Account Settings > Help Center** in your admin dashboard.\n";

      // Log assistant fallback turn to DB
      if (conversationId) {
        await saveAssistantMessage(conversationId, assistantMessageId, fallbackMessage);
      }

      return new Response(fallbackMessage, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Confidence-Passed": "false",
          "X-Message-Id": assistantMessageId,
        },
      });
    }

    // 4. Construct Context-Augmented Prompt
    const contextPrompt = retrieval.chunks
      .map(
        (chunk, idx) =>
          `[Source ${idx + 1}] Title: ${chunk.title} | Section: ${chunk.section}\n${chunk.content}`
      )
      .join("\n\n---\n\n");

    const fullUserPrompt = `Knowledge Base Context:\n${contextPrompt}\n\nUser Question: ${message}`;

    const systemInstruction =
      "You are Deskwise, an AI customer support assistant for SaaS billing & subscription support.\n" +
      "STRICT RULES:\n" +
      "1. Answer the user's question accurately using ONLY the provided Knowledge Base Context.\n" +
      "2. Be concise, professional, and clear.\n" +
      "3. Reference source documents when explaining policies.\n" +
      "4. Do NOT hallucinate information not present in the context.";

    // Format citations header for UI display
    const citationData = buildCitationsHeader(retrieval.chunks);

    const streamHeaders = {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Citations": citationData,
      "X-Message-Id": assistantMessageId,
    };

    // 5. Call Gemini Stream
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "dummy-key-for-dev") {
      const mockResponse =
        `Based on our **${retrieval.chunks[0]?.title || "Billing"}** documentation:\n\n` +
        `${retrieval.chunks[0]?.content.slice(0, 300)}...\n\n` +
        `If you need further assistance, our team is available at support@deskwise.io.`;

      const mockStream = new ReadableStream({
        async start(controller) {
          for (let i = 0; i < mockResponse.length; i += 4) {
            controller.enqueue(encoder.encode(mockResponse.slice(i, i + 4)));
            await new Promise((r) => setTimeout(r, 20));
          }
          controller.close();
        },
      });

      if (conversationId) {
        await saveAssistantMessage(conversationId, assistantMessageId, mockResponse);
      }

      return new Response(mockStream, { headers: streamHeaders });
    }

    // Opening the stream is where quota/auth failures surface. Awaiting it here
    // — before any bytes are committed — means an upstream 429 can still be
    // answered with a proper 429 instead of a half-written 200.
    let responseStream;
    try {
      responseStream = await ai.models.generateContentStream({
        model: MODEL_NAME,
        contents: fullUserPrompt,
        config: {
          systemInstruction,
        },
      });
    } catch (err) {
      throw toUpstreamError(err, "answer generation");
    }

    let fullAssistantResponse = "";

    const customReadable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            const chunkText = chunk.text || "";
            fullAssistantResponse += chunkText;
            controller.enqueue(encoder.encode(chunkText));
          }
        } catch (streamErr) {
          // Headers are already flushed, so the only channel left is the body.
          // Emit the sanitised message — never the raw provider payload.
          const upstream = toUpstreamError(streamErr, "answer generation");
          logUpstream("Chat API] Gemini streaming error", upstream);
          controller.enqueue(encoder.encode(`\n\n_${upstream.publicMessage}_`));
          fullAssistantResponse += `\n\n_${upstream.publicMessage}_`;
        }

        controller.close();

        // Save Assistant Message with Cited Chunk IDs to DB
        if (conversationId) {
          await saveAssistantMessage(
            conversationId,
            assistantMessageId,
            fullAssistantResponse,
            retrieval.chunks.map((c) => c.id)
          );
        }
      },
    });

    return new Response(customReadable, { headers: streamHeaders });
  } catch (error) {
    if (error instanceof UpstreamError) {
      logUpstream("Chat API", error);
      return NextResponse.json(
        { error: error.publicMessage, retryAfterMs: (error.retryAfterSeconds ?? 0) * 1000 },
        {
          status: error.status,
          headers: error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : undefined,
        }
      );
    }

    console.error("[Chat API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Something went wrong handling your message. Please try again." },
      { status: 500 }
    );
  }
}
