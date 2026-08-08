/**
 * Fetching a document from a user-supplied link.
 *
 * This is a server-side request to an address the user chose, which is the
 * classic SSRF shape: without checks, a visitor can point the app at
 * `http://169.254.169.254/` (cloud metadata), at a Postgres port on the private
 * network, or at `http://localhost:3000/api/admin/...` — and the *server's*
 * network position, not theirs, is what would be used.
 *
 * The guards here are, in order:
 *   1. http(s) only — no file:, gopher:, data:
 *   2. every hop resolved with DNS and each resolved address checked against
 *      the private/loopback/link-local ranges
 *   3. redirects followed manually, revalidating each hop (a public host is
 *      free to redirect to 127.0.0.1)
 *   4. hard caps on size and time
 *
 * A residual TOCTOU window remains between the DNS check and the connection —
 * closing it properly needs a custom agent that pins the checked address. At
 * this scale the ranges check plus the response-size cap is the proportionate
 * control; a deployment handling untrusted traffic at scale should put an egress
 * proxy in front of this instead.
 */

import dns from "dns/promises";
import net from "net";
import { extensionForContentType, extensionOf, isSupportedFile } from "./parsers";

export const URL_FETCH_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  timeoutMs: 15_000,
  maxRedirects: 3,
} as const;

export class UrlFetchError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "UrlFetchError";
    this.status = status;
  }
}

export interface FetchedDocument {
  filename: string;
  buffer: Buffer;
  contentType: string;
  /** Final URL after redirects. */
  url: string;
}

/** Expand any IPv6 form — compressed, mixed, mapped — into eight 16-bit groups. */
function parseIPv6(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0]; // drop any zone id

  // Mixed notation (::ffff:127.0.0.1) — fold the dotted quad into two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
    text =
      text.slice(0, dotted.index) +
      ((octets[0] << 8) | octets[1]).toString(16) +
      ":" +
      ((octets[2] << 8) | octets[3]).toString(16);
  }

  const [head, tail, ...extra] = text.split("::");
  if (extra.length > 0) return null;

  const toGroups = (part: string) =>
    part ? part.split(":").map((group) => parseInt(group, 16)) : [];

  const left = toGroups(head);
  const right = tail === undefined ? [] : toGroups(tail);

  if ([...left, ...right].some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)) {
    return null;
  }

  if (tail === undefined) return left.length === 8 ? left : null;

  const fill = 8 - left.length - right.length;
  if (fill < 0) return null;

  return [...left, ...new Array(fill).fill(0), ...right];
}

/**
 * Reject anything that isn't a publicly routable unicast address.
 * Exported so `scripts/ssrf-check.ts` can assert the ranges directly.
 */
export function isBlockedAddress(address: string): boolean {
  const version = net.isIP(address);

  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true; // this-network, private, loopback
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 192 && b === 0) return true; // IETF protocol assignments
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const groups = parseIPv6(address);
    if (!groups) return true; // unparseable — refuse rather than guess

    const isZeroPrefix = groups.slice(0, 5).every((group) => group === 0);

    // IPv4-mapped and IPv4-compatible addresses tunnel a v4 target through v6
    // notation. WHATWG URL parsing rewrites ::ffff:127.0.0.1 into its hex form
    // (::ffff:7f00:1), so the embedded address has to be reconstructed from the
    // groups rather than matched as text — that string match was a bypass.
    if (isZeroPrefix && (groups[5] === 0xffff || groups[5] === 0)) {
      const embedded = [
        groups[6] >> 8,
        groups[6] & 0xff,
        groups[7] >> 8,
        groups[7] & 0xff,
      ].join(".");
      // ::0 and ::1 fold into this branch too, and are blocked by the v4 rules
      // (0.0.0.0 → a === 0, 0.0.0.1 → a === 0).
      return isBlockedAddress(embedded);
    }

    if (groups[0] >= 0xfe80 && groups[0] <= 0xfebf) return true; // link-local
    if ((groups[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((groups[0] & 0xff00) === 0xff00) return true; // multicast
    if (groups[0] === 0x0064 && groups[1] === 0xff9b) return true; // NAT64
    if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation

    return false;
  }

  return true; // not an IP literal at all
}

/** Validate the scheme and resolve the host, rejecting internal destinations. */
async function assertPublicUrl(target: URL): Promise<void> {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new UrlFetchError("Only http:// and https:// links can be imported.");
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, "");

  if (/^(localhost|.*\.local|.*\.internal|.*\.localdomain)$/i.test(hostname)) {
    throw new UrlFetchError("That link points to an internal address.", 403);
  }

  if (net.isIP(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new UrlFetchError("That link points to an internal address.", 403);
    }
    return;
  }

  let records: { address: string }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new UrlFetchError("That link's domain could not be resolved.");
  }

  if (records.length === 0 || records.some((record) => isBlockedAddress(record.address))) {
    throw new UrlFetchError("That link points to an internal address.", 403);
  }
}

/** Filename from Content-Disposition, else the URL path, else the hostname. */
function deriveFilename(target: URL, contentType: string, disposition: string | null): string {
  const fromDisposition =
    /filename\*=UTF-8''([^;]+)/i.exec(disposition || "")?.[1] ||
    /filename="?([^";]+)"?/i.exec(disposition || "")?.[1];

  let name = fromDisposition ? decodeURIComponent(fromDisposition) : "";

  if (!name) {
    const lastSegment = target.pathname.split("/").filter(Boolean).pop();
    name = lastSegment ? decodeURIComponent(lastSegment) : "";
  }

  if (!name) name = target.hostname.replace(/^www\./, "");

  // A link like /docs/billing or /export?format=pdf has no usable extension —
  // take it from the response's own Content-Type instead.
  if (!isSupportedFile(name)) {
    const extension = extensionForContentType(contentType);
    if (extension) name = `${name.replace(/\.[a-z0-9]+$/i, "") || "document"}${extension}`;
  }

  return name.split(/[\\/]/).pop() || "document";
}

/** Read the body with a hard byte ceiling, so a huge file can't exhaust memory. */
async function readCapped(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > URL_FETCH_LIMITS.maxBytes) {
    throw new UrlFetchError(
      `That document is ${(declared / 1024 / 1024).toFixed(1)} MB. The limit is ${
        URL_FETCH_LIMITS.maxBytes / 1024 / 1024
      } MB.`,
      413
    );
  }

  if (!response.body) return Buffer.from(await response.arrayBuffer());

  const reader = response.body.getReader();
  const parts: Buffer[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > URL_FETCH_LIMITS.maxBytes) {
      await reader.cancel();
      throw new UrlFetchError(
        `That document exceeds the ${URL_FETCH_LIMITS.maxBytes / 1024 / 1024} MB limit.`,
        413
      );
    }
    parts.push(Buffer.from(value));
  }

  return Buffer.concat(parts);
}

/** Download a document from a public URL, following redirects safely. */
export async function fetchRemoteDocument(rawUrl: string): Promise<FetchedDocument> {
  let target: URL;
  try {
    target = new URL(rawUrl.trim());
  } catch {
    throw new UrlFetchError("That doesn't look like a valid link.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), URL_FETCH_LIMITS.timeoutMs);

  try {
    for (let hop = 0; hop <= URL_FETCH_LIMITS.maxRedirects; hop++) {
      await assertPublicUrl(target);

      let response: Response;
      try {
        response = await fetch(target, {
          redirect: "manual", // each hop is revalidated rather than trusted
          signal: controller.signal,
          headers: {
            // Some hosts serve a different (or no) body without these.
            "User-Agent": "Deskwise-DocumentImporter/1.0",
            Accept:
              "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,text/csv,application/json,text/html;q=0.9,*/*;q=0.5",
          },
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new UrlFetchError("That link took too long to respond.", 504);
        }
        console.warn("[FetchUrl] Request failed:", err);
        throw new UrlFetchError("That link could not be reached.", 502);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new UrlFetchError("That link redirected nowhere.", 502);
        target = new URL(location, target);
        continue;
      }

      if (!response.ok) {
        throw new UrlFetchError(
          `That link returned ${response.status}. Check that it's publicly accessible.`,
          response.status === 404 ? 404 : 502
        );
      }

      const contentType = response.headers.get("content-type") || "";
      const filename = deriveFilename(
        target,
        contentType,
        response.headers.get("content-disposition")
      );

      if (!isSupportedFile(filename)) {
        const extension = extensionOf(filename) || contentType.split(";")[0] || "unknown";
        throw new UrlFetchError(
          `That link serves "${extension}", which isn't a supported document format.`,
          415
        );
      }

      return {
        filename,
        buffer: await readCapped(response),
        contentType,
        url: target.toString(),
      };
    }

    throw new UrlFetchError("That link redirected too many times.", 502);
  } finally {
    clearTimeout(timeout);
  }
}
