import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

// Graceful fallback if DATABASE_URL is not set yet in local environment
export const db = connectionString
  ? drizzle(neon(connectionString), { schema })
  : null;
