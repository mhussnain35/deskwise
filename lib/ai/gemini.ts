import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY || "";

export const ai = new GoogleGenAI({ apiKey: apiKey || "dummy-key-for-dev" });

export const MODEL_NAME = "gemini-2.0-flash";
