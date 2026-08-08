import "./load-env";
import { isBlockedAddress } from "../lib/rag/fetch-url";

/**
 * Address-guard assertions for the URL importer.
 *
 *   npx tsx scripts/ssrf-check.ts
 *
 * Hostnames are run through the WHATWG URL parser first, because that is what
 * rewrites `::ffff:127.0.0.1` into `::ffff:7f00:1`, `127.1` into `127.0.0.1`
 * and `2130706433` into `127.0.0.1` — normalisations that a naive string match
 * on the raw input would miss entirely.
 */
const CASES: { url: string; blocked: boolean; note: string }[] = [
  { url: "http://[::ffff:127.0.0.1]:3000/", blocked: true, note: "IPv4-mapped loopback" },
  { url: "http://[::ffff:7f00:1]:3000/", blocked: true, note: "IPv4-mapped loopback, hex form" },
  { url: "http://[0:0:0:0:0:ffff:a9fe:a9fe]/", blocked: true, note: "IPv4-mapped metadata" },
  { url: "http://[::1]/", blocked: true, note: "IPv6 loopback" },
  { url: "http://[::]/", blocked: true, note: "IPv6 unspecified" },
  { url: "http://[fe80::1]/", blocked: true, note: "IPv6 link-local" },
  { url: "http://[fd00::1]/", blocked: true, note: "IPv6 unique local" },
  { url: "http://[ff02::1]/", blocked: true, note: "IPv6 multicast" },
  { url: "http://[2001:db8::1]/", blocked: true, note: "IPv6 documentation range" },
  { url: "http://[2606:4700:4700::1111]/", blocked: false, note: "public IPv6 resolver" },
  { url: "http://127.0.0.1/", blocked: true, note: "loopback" },
  { url: "http://127.1/", blocked: true, note: "shorthand loopback" },
  { url: "http://2130706433/", blocked: true, note: "decimal loopback" },
  { url: "http://0177.0.0.1/", blocked: true, note: "octal loopback" },
  { url: "http://0.0.0.0/", blocked: true, note: "this-network" },
  { url: "http://169.254.169.254/", blocked: true, note: "cloud metadata" },
  { url: "http://10.1.2.3/", blocked: true, note: "private 10/8" },
  { url: "http://172.16.0.1/", blocked: true, note: "private 172.16/12" },
  { url: "http://172.32.0.1/", blocked: false, note: "public, just outside 172.16/12" },
  { url: "http://192.168.0.1/", blocked: true, note: "private 192.168/16" },
  { url: "http://100.64.0.1/", blocked: true, note: "carrier-grade NAT" },
  { url: "http://8.8.8.8/", blocked: false, note: "public resolver" },
];

let failures = 0;

for (const testCase of CASES) {
  const hostname = new URL(testCase.url).hostname.replace(/^\[|\]$/g, "");
  const actual = isBlockedAddress(hostname);
  const pass = actual === testCase.blocked;
  if (!pass) failures++;

  console.log(
    `${pass ? "✅" : "❌"} ${testCase.blocked ? "block " : "allow "} ${hostname.padEnd(26)} ${testCase.note}`
  );
}

console.log(
  `\n${CASES.length - failures}/${CASES.length} passed` + (failures ? " — FAILURES PRESENT" : "")
);
process.exit(failures ? 1 : 0);
