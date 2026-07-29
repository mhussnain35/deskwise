import { NextRequest, NextResponse } from "next/server";
import { ai, MODEL_NAME } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { retrieveContext } from "@/lib/rag/retriever";
import { checkRateLimit } from "@/lib/rate-limit";
import { eq } from "drizzle-orm";

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
      if (db && conversationId) {
        try {
          await db.insert(messages).values({
            conversationId: conversationId,
            role: "assistant",
            content: fallbackMessage,
          });
        } catch (saveErr) {
          console.error("[Chat API] Error saving fallback response:", saveErr);
        }
      }

      return new Response(fallbackMessage, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Confidence-Passed": "false",
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
    const citationData = JSON.stringify(
      retrieval.chunks.map((c) => ({
        id: c.id,
        title: c.title,
        section: c.section,
        content: c.content,
        score: c.score,
      }))
    );

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

      return new Response(mockStream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Citations": encodeURIComponent(citationData),
        },
      });
    }

    const responseStream = await ai.models.generateContentStream({
      model: MODEL_NAME,
      contents: fullUserPrompt,
      config: {
        systemInstruction,
      },
    });

    let fullAssistantResponse = "";

    const customReadable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of responseStream) {
            const chunkText = chunk.text || "";
            fullAssistantResponse += chunkText;
            controller.enqueue(encoder.encode(chunkText));
          }
          controller.close();

          // Save Assistant Message with Cited Chunk IDs to DB
          if (db && conversationId) {
            try {
              await db.insert(messages).values({
                conversationId: conversationId,
                role: "assistant",
                content: fullAssistantResponse,
                citedChunkIds: retrieval.chunks.map((c) => c.id),
              });
            } catch (saveErr) {
              console.error("[Chat API] Error saving assistant response:", saveErr);
            }
          }
        } catch (streamErr: any) {
          console.error("[Chat API] Gemini streaming error:", streamErr);
          controller.enqueue(
            encoder.encode(`\n[Error streaming response: ${streamErr?.message || "Gemini API error"}]`)
          );
          controller.close();
        }
      },
    });

    return new Response(customReadable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Citations": encodeURIComponent(citationData),
      },
    });
  } catch (error: any) {
    console.error("[Chat API] Unexpected error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
