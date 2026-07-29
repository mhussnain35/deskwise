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

    return true;
  } catch (err) {
    console.error("[Qdrant] Error initializing collection:", err);
    return false;
  }
}
