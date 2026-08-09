import http from "http";

/**
 * Offline verification of the OpenAI-compatible provider path.
 *
 *   npx tsx scripts/openrouter-mock-check.ts
 *
 * Runs the real streaming and embedding code against a local mock of the
 * OpenRouter API, so the parts most likely to break silently are covered
 * without spending a token or needing a key:
 *
 *   - SSE frames split across TCP chunks
 *   - `: OPENROUTER PROCESSING` keep-alive comments
 *   - `[DONE]` termination
 *   - errors arriving *after* a 200, inside the stream
 *   - HTTP 429 → retryable UpstreamError, with the provider body kept server-side
 *   - embedding width, and the loud failure when it doesn't match config
 *
 * `scripts/provider-check.ts` is the companion that talks to the real service.
 */

const PORT = 34567;

let lastChatBody: Record<string, unknown> | null = null;
let lastEmbedBody: Record<string, unknown> | null = null;
let lastAuthHeader: string | undefined;
let lastTitleHeader: string | undefined;

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    lastAuthHeader = req.headers["authorization"] as string | undefined;
    lastTitleHeader = req.headers["x-title"] as string | undefined;
    const body = raw ? JSON.parse(raw) : {};

    if (req.url?.endsWith("/chat/completions")) {
      lastChatBody = body;

      if (body.model === "force-429") {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "37" });
        res.end(JSON.stringify({ error: { message: "account rate limited", code: 429 } }));
        return;
      }

      if (body.model === "force-midstream-error") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "partial" } }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ error: { message: "provider died", code: 502 } })}\n\n`);
        res.end();
        return;
      }

      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": OPENROUTER PROCESSING\n\n");
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" } }] })}\n\n`);

      // Deliberately split one frame across two writes.
      const frame = `data: ${JSON.stringify({ choices: [{ delta: { content: " world" } }] })}\n\n`;
      res.write(frame.slice(0, 20));
      setTimeout(() => {
        res.write(frame.slice(20));
        res.write(": OPENROUTER PROCESSING\n\n");
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "!" } }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }, 30);
      return;
    }

    if (req.url?.endsWith("/embeddings")) {
      lastEmbedBody = body;
      // Some models ignore the `dimensions` request and return their native
      // width. That is the case the dimension guard exists for.
      const dimensions =
        body.input === "__ignores_dimensions__" ? 1536 : Number(body.dimensions) || 1536;
      // Deliberately not unit-length, to prove normalisation happens our side.
      const vector = Array.from({ length: dimensions }, (_, i) => ((i % 7) + 1) * 0.5);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ embedding: vector, index: 0 }] }));
      return;
    }

    res.writeHead(404).end("{}");
  });
});

let failures = 0;

function check(name: string, pass: boolean, detail = "") {
  console.log(`${pass ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
}

async function main() {
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  // Provider config is read at module load, so it must be set before importing.
  process.env.AI_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "sk-or-v1-test-key";
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${PORT}`;
  process.env.OPENROUTER_MODEL = "test/model";
  process.env.OPENROUTER_EMBEDDING_MODEL = "test/embed";
  process.env.OPENROUTER_SITE_NAME = "Deskwise";
  process.env.EMBEDDING_DIMENSION = "768";

  const { streamAnswer } = await import("../lib/ai/llm");
  const { embedText } = await import("../lib/ai/embeddings");
  const { UpstreamError } = await import("../lib/errors");

  console.log("\n— streaming —");
  const stream = await streamAnswer({
    system: "sys prompt",
    turns: [
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ],
  });

  let text = "";
  const deltas: string[] = [];
  for await (const delta of stream) {
    text += delta;
    deltas.push(delta);
  }

  const messages = (lastChatBody?.messages ?? []) as { role: string }[];
  check("reassembles a frame split across chunks", text === "Hello world!", `got "${text}"`);
  check("skips keep-alive comment lines", deltas.length === 3, `${deltas.length} deltas`);
  check("sends the system prompt as a system message", messages[0]?.role === "system");
  check(
    "preserves prior turns and roles",
    JSON.stringify(messages.map((m) => m.role)) ===
      JSON.stringify(["system", "user", "assistant", "user"])
  );
  check("requests a stream", lastChatBody?.stream === true);
  check("sends the bearer token", lastAuthHeader === "Bearer sk-or-v1-test-key");
  check("sends the attribution header", lastTitleHeader === "Deskwise");

  console.log("\n— embeddings —");
  const vector = await embedText("hello");
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  check("width honours EMBEDDING_DIMENSION", vector.length === 768, `${vector.length}`);
  check("asks the provider for that width", lastEmbedBody?.dimensions === 768);
  check("asks for float encoding", lastEmbedBody?.encoding_format === "float");
  check("normalises to unit length", Math.abs(norm - 1) < 1e-9, `norm=${norm.toFixed(9)}`);

  console.log("\n— failure handling —");
  try {
    // The mock returns its native 1536 for this input, ignoring the request.
    await embedText("__ignores_dimensions__");
    check("width mismatch is rejected", false, "no error raised");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(
      "width mismatch is rejected with actionable guidance",
      message.includes("EMBEDDING_DIMENSION") && message.includes("1536"),
      message.slice(0, 100)
    );
  }

  process.env.OPENROUTER_MODEL = "force-429";
  const llm429 = await import(`../lib/ai/llm?bust=${Date.now()}`);
  try {
    await llm429.streamAnswer({ system: "s", turns: [{ role: "user", content: "x" }] });
    check("HTTP 429 surfaces as an error", false, "no error raised");
  } catch (err) {
    const upstream = err as InstanceType<typeof UpstreamError>;
    check("HTTP 429 keeps its status", upstream.status === 429, `status=${upstream.status}`);
    check("Retry-After is parsed", upstream.retryAfterSeconds === 37, `${upstream.retryAfterSeconds}`);
    check(
      "provider body is not shown to the user",
      !/account rate limited/i.test(upstream.publicMessage),
      upstream.publicMessage
    );
  }

  process.env.OPENROUTER_MODEL = "force-midstream-error";
  const llmMid = await import(`../lib/ai/llm?bust=${Date.now()}`);
  try {
    const midStream = await llmMid.streamAnswer({
      system: "s",
      turns: [{ role: "user", content: "x" }],
    });
    let streamed = "";
    for await (const delta of midStream) streamed += delta;
    check("error after a 200 is raised", false, `streamed "${streamed}" without error`);
  } catch (err) {
    const upstream = err as InstanceType<typeof UpstreamError>;
    check("error after a 200 is raised", upstream instanceof UpstreamError);
    check(
      "mid-stream provider text is not shown to the user",
      !/provider died/i.test(upstream.publicMessage ?? "")
    );
  }

  // Close and let the loop drain naturally — process.exit() while the server
  // handle is still closing trips a libuv assertion on Windows.
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log(`\n${failures === 0 ? "✅ All checks passed." : `❌ ${failures} check(s) failed.`}`);
  process.exitCode = failures ? 1 : 0;
}

main().catch(async (err) => {
  console.error(err);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.exitCode = 1;
});
