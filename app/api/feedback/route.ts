import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { feedback } from "@/lib/db/schema";

export async function POST(req: NextRequest) {
  try {
    const { messageId, rating } = await req.json();

    if (!messageId || !rating || !["up", "down"].includes(rating)) {
      return NextResponse.json(
        { error: "Invalid payload: messageId and rating ('up'|'down') required" },
        { status: 400 }
      );
    }

    if (db) {
      try {
        await db.insert(feedback).values({
          messageId: messageId,
          rating: rating,
        });
      } catch (dbErr) {
        console.error("[Feedback API] DB insert error:", dbErr);
      }
    }

    return NextResponse.json({ success: true, messageId, rating });
  } catch (error: any) {
    console.error("[Feedback API] Unexpected error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
