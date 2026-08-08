/**
 * Session ids are minted in the browser and travel in request bodies, query
 * strings and route params. They key every per-visitor row in Postgres, so the
 * shape is validated before use rather than trusted.
 */
const SESSION_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_PATTERN.test(value);
}
