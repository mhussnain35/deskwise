import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";

export const ai = new GoogleGenAI({ apiKey: apiKey || "dummy-key-for-dev" });

/**
 * Generation model, overridable with GEMINI_MODEL.
 *
 * Google's free tier is granted per model and changes over time — a key can
 * hold a working quota for one model while returning `limit: 0` on a daily
 * quota for another, which surfaces as a permanent 429 that looks like a bug in
 * this app. Keeping the id in the environment means switching models is a
 * config change rather than a redeploy of new code. `gemini-flash-latest` is a
 * good alternative when `gemini-2.0-flash` reports no free-tier quota.
 */
export const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.0-flash";
