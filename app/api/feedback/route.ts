import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { feedback } from "@/lib/db/schema";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  try {
    const { messageId, rating } = await req.json();

    if (!messageId || !rating || !["up", "down"].includes(rating)) {
      return NextResponse.json(
        { error: "Invalid payload: messageId and rating ('up'|'down') required" },
        { status: 400 }
      );
    }

    // feedback.message_id is a uuid foreign key. Anything else is rejected by
    // Postgres, and this route used to swallow that error and still answer
    // `{ success: true }` — so every rating was silently dropped.
    if (!UUID_PATTERN.test(messageId)) {
      return NextResponse.json(
        { error: "messageId must be the message UUID returned by /api/chat" },
        { status: 400 }
      );
    }

    if (!db) {
      return NextResponse.json(
        { error: "Feedback storage is not configured." },
        { status: 503 }
      );
    }

    try {
      await db.insert(feedback).values({ messageId, rating });
    } catch (dbErr) {
      console.error("[Feedback API] DB insert error:", dbErr);
      return NextResponse.json(
        { error: "Could not record feedback for that message." },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, messageId, rating });
  } catch (error) {
    console.error("[Feedback API] Unexpected error:", error);
    return NextResponse.json(
      { error: "Something went wrong recording your feedback." },
      { status: 500 }
    );
  }
}
