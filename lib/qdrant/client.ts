import { QdrantClient } from "@qdrant/js-client-rest";
import { VECTOR_DIMENSION } from "../ai/embeddings";

export const COLLECTION_NAME = "support_kb";

const qdrantUrl = process.env.QDRANT_URL;
const qdrantApiKey = process.env.QDRANT_API_KEY;

// Graceful fallback if Qdrant credentials are not set yet
export const qdrant = qdrantUrl
  ? new QdrantClient({
      url: qdrantUrl,
      apiKey: qdrantApiKey || undefined,
    })
  : null;

/**
 * Ensures the Qdrant `support_kb` collection exists with 768-dimension Cosine distance vector config
 */
export async function ensureCollectionExists(): Promise<boolean> {
  if (!qdrant) {
    console.log("[Qdrant] QDRANT_URL not configured. Skipping remote collection check.");
    return false;
  }

  try {
    const { collections } = await qdrant.getCollections();
    const exists = collections.some((c) => c.name === COLLECTION_NAME);

    if (exists) await assertCollectionDimension();

    if (!exists) {
      console.log(`[Qdrant] Creating collection "${COLLECTION_NAME}"...`);
      await qdrant.createCollection(COLLECTION_NAME, {
        vectors: {
          size: VECTOR_DIMENSION,
          distance: "Cosine",
        },
      });
      console.log(`[Qdrant] Collection "${COLLECTION_NAME}" created successfully.`);
    } else {
      console.log(`[Qdrant] Collection "${COLLECTION_NAME}" verified.`);
    }

    await ensurePayloadIndexes();
    return true;
  } catch (err) {
    console.error("[Qdrant] Error initializing collection:", err);
    return false;
  }
}

/**
 * Warn when the live collection's width doesn't match the configured embedding
 * dimension.
 *
 * Switching embedding model or provider is exactly when this bites: Qdrant
 * rejects every upsert with a size error while searches keep returning the old
 * vectors, so indexing appears to succeed and retrieval quietly serves stale
 * results. Naming it here turns a confusing outage into one line in the log.
 */
async function assertCollectionDimension(): Promise<void> {
  if (!qdrant) return;

  try {
    const info = await qdrant.getCollection(COLLECTION_NAME);
    const vectors = info.config?.params?.vectors;
    const size = typeof vectors === "object" && vectors && "size" in vectors
      ? Number((vectors as { size?: number }).size)
      : undefined;

    if (size && size !== VECTOR_DIMENSION) {
      console.error(
        `[Qdrant] Collection "${COLLECTION_NAME}" stores ${size}-d vectors but EMBEDDING_DIMENSION is ${VECTOR_DIMENSION}. ` +
          `Upserts will be rejected. Delete the collection and re-run "npx tsx scripts/ingest.ts", ` +
          `or set EMBEDDING_DIMENSION=${size}.`
      );
    }
  } catch (err) {
    console.warn("[Qdrant] Could not read collection config:", err);
  }
}

/**
 * Payload indexes required by the re-index cleanup filter, which removes points
 * belonging to a document that no longer has that many chunks. Qdrant rejects
 * filtered deletes on unindexed keys. Creating an existing index is a no-op.
 */
async function ensurePayloadIndexes(): Promise<void> {
  if (!qdrant) return;

  const indexes: { field: string; schema: "keyword" | "integer" }[] = [
    { field: "filename", schema: "keyword" },
    { field: "chunk_index", schema: "integer" },
  ];

  for (const { field, schema } of indexes) {
    try {
      await qdrant.createPayloadIndex(COLLECTION_NAME, {
        field_name: field,
        field_schema: schema,
        wait: true,
      });
    } catch (err) {
      console.warn(`[Qdrant] Could not ensure payload index on "${field}":`, err);
    }
  }
}
