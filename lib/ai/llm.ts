import { ai } from "./gemini";
import {
  AI_PROVIDER,
  OPENROUTER_BASE_URL,
  generationModel,
  openRouterHeaders,
} from "./provider";
import { UpstreamError, toUpstreamError } from "../errors";

/**
 * Provider-agnostic streaming generation.
 *
 * The chat route knows nothing about which vendor is answering: it awaits a
 * stream of text deltas and forwards them. Awaiting the *opening* of the stream
 * matters — that is where auth and quota failures surface, and catching them
 * before any bytes are committed is what lets a 429 be answered as a 429 rather
 * than as a half-written 200.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface StreamRequest {
  system: string;
  turns: ChatTurn[];
}

export async function streamAnswer(request: StreamRequest): Promise<AsyncIterable<string>> {
  return AI_PROVIDER === "openrouter" ? streamOpenRouter(request) : streamGemini(request);
}

// --- Gemini -----------------------------------------------------------------

async function streamGemini({ system, turns }: StreamRequest): Promise<AsyncIterable<string>> {
  let response;
  try {
    response = await ai.models.generateContentStream({
      model: generationModel(),
      contents: turns.map((turn) => ({
        role: turn.role === "assistant" ? "model" : "user",
        parts: [{ text: turn.content }],
      })),
      config: { systemInstruction: system },
    });
  } catch (err) {
    throw toUpstreamError(err, "answer generation");
  }

  return (async function* () {
    for await (const chunk of response) {
      if (chunk.text) yield chunk.text;
    }
  })();
}

// --- OpenRouter (OpenAI-compatible) -----------------------------------------

async function streamOpenRouter({ system, turns }: StreamRequest): Promise<AsyncIterable<string>> {
  let response: Response;

  try {
    response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: openRouterHeaders(),
      body: JSON.stringify({
        model: generationModel(),
        stream: true,
        messages: [{ role: "system", content: system }, ...turns],
      }),
    });
  } catch (err) {
    throw toUpstreamError(err, "answer generation");
  }

  if (!response.ok || !response.body) {
    throw await openRouterError(response, "answer generation");
  }

  return readOpenRouterStream(response.body);
}

/**
 * Parse an OpenAI-style SSE stream into text deltas.
 *
 * Three details this has to get right:
 *   - OpenRouter emits `: OPENROUTER PROCESSING` comment lines as keep-alives
 *     while a slow provider warms up; they are not JSON and must be skipped
 *   - a chunk can split mid-line, so the tail is buffered rather than parsed
 *   - errors can arrive *inside* the stream, after a 200, as an `error` object
 */
async function* readOpenRouterStream(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the partial line for the next chunk

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;

        let parsed: {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string; code?: number };
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // partial or non-JSON keep-alive frame
        }

        if (parsed.error) {
          throw new UpstreamError(
            "The AI service failed part-way through the answer. Please try again.",
            parsed.error.code && parsed.error.code >= 400 && parsed.error.code < 600
              ? parsed.error.code
              : 502,
            { cause: parsed.error }
          );
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

/**
 * Convert a non-2xx OpenRouter response into an UpstreamError.
 * The provider body is read for logging only — never returned to the browser,
 * since it can carry account, key and routing detail.
 */
export async function openRouterError(response: Response, context: string): Promise<UpstreamError> {
  let detail = "";
  try {
    detail = await response.text();
  } catch {
    detail = "<unreadable body>";
  }

  const retryAfterHeader = Number(response.headers.get("retry-after"));
  const retryAfterSeconds = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
    ? retryAfterHeader
    : undefined;

  if (response.status === 429) {
    return new UpstreamError(
      retryAfterSeconds
        ? `The AI service is rate limited right now. Please try again in about ${retryAfterSeconds} seconds.`
        : "The AI service is rate limited right now. Please try again in a moment.",
      429,
      { cause: detail, retryAfterSeconds }
    );
  }

  if (response.status === 401 || response.status === 403) {
    return new UpstreamError(
      "The AI service rejected this request. Check that OPENROUTER_API_KEY is valid.",
      502,
      { cause: detail }
    );
  }

  if (response.status === 402) {
    return new UpstreamError(
      "The AI account has insufficient credit for this request.",
      502,
      { cause: detail }
    );
  }

  // "No endpoints found for <model>" — the id is retired, misspelled, or not
  // routable for this account. A configuration mistake, not an outage, so it
  // must not be reported as something that will fix itself.
  if (response.status === 404) {
    const model = /No endpoints found for ([\w./:-]+)/.exec(detail)?.[1];
    return new UpstreamError(
      model
        ? `The configured model "${model}" is not available on OpenRouter. Check the id against https://openrouter.ai/models — ids change as models are retired.`
        : "The configured AI model was not found. Check OPENROUTER_MODEL against https://openrouter.ai/models.",
      502,
      { cause: detail }
    );
  }

  return new UpstreamError(
    `The AI service is temporarily unavailable (${context}). Please try again shortly.`,
    502,
    { cause: detail }
  );
}
