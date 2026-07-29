import { NextRequest, NextResponse } from "next/server";
import { ai, MODEL_NAME } from "@/lib/ai/gemini";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: NextRequest) {
  try {
    const { message, sessionId } = await req.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const activeSessionId = sessionId || "default-session";
    let conversationId: string | null = null;

    // 1. Database Operations (if Neon DB is connected)
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
        console.error("[Chat API] DB Error (proceeding with streaming):", dbErr);
      }
    }

    // 2. Stream Response from Gemini or Mock Fallback if API key missing
    const encoder = new TextEncoder();

    if (!process.env.GEMINI_API_KEY) {
      const mockStream = new ReadableStream({
        async start(controller) {
          const mockText = `[Demo Mode - Please set GEMINI_API_KEY in .env.local]\n\nThank you for reaching out to Deskwise! You asked: "${message}". In production, Gemini 2.0 Flash streams real-time answers using our SaaS knowledge base.`;
          for (let i = 0; i < mockText.length; i += 3) {
            controller.enqueue(encoder.encode(mockText.slice(i, i + 3)));
            await new Promise((r) => setTimeout(r, 20));
          }
          controller.close();
        },
      });
      return new Response(mockStream, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    // Call Gemini Stream
    const responseStream = await ai.models.generateContentStream({
      model: MODEL_NAME,
      contents: message,
      config: {
        systemInstruction:
          "You are Deskwise, an AI customer support assistant for SaaS billing & subscription support. Be helpful, concise, and professional.",
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

          // 3. Save Assistant Message to DB upon completion
          if (db && conversationId) {
            try {
              await db.insert(messages).values({
                conversationId: conversationId,
                role: "assistant",
                content: fullAssistantResponse,
              });
            } catch (saveErr) {
              console.error("[Chat API] Error saving assistant response:", saveErr);
            }
          }
        } catch (streamErr: any) {
          console.error("[Chat API] Gemini streaming error:", streamErr);
          const errorMsg = `\n[Error streaming response: ${streamErr?.message || "Gemini API error"}]`;
          controller.enqueue(encoder.encode(errorMsg));
          controller.close();
        }
      },
    });

    return new Response(customReadable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
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
