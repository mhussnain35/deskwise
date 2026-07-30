import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const rawUrl = process.env.DATABASE_URL || "";
// Clean up connection string to prevent HTTP neon driver parsing issues with query parameters like channel_binding
const connectionString = rawUrl
  ? rawUrl.replace(/([?&])channel_binding=[^&]*&?/, "$1").replace(/\?$/, "")
  : "";

// Graceful fallback if DATABASE_URL is not set yet in local environment
export const db = connectionString
  ? drizzle(neon(connectionString), { schema })
  : null;

