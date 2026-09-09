import { createHash } from "node:crypto";

/**
 * Literal hostname/IP-range denylist for `workspace_browse`'s SSRF guard. This
 * is NOT a DNS-resolution-based defense — a hostname that resolves to a
 * private address only after this check (DNS rebinding) is not caught. Stated,
 * not hidden, matching this codebase's own convention for real limitations
 * (see SEMANTIC_UNAVAILABLE_NOTICE in packages/core/src/services/intelligence.ts).
 * Matches against the FULL hostname only, never a substring, so a public
 * domain that happens to start with a blocked octet (e.g. "10.example.com")
 * is never falsely rejected.
 */
const BLOCKED_HOSTNAME_PATTERNS: readonly RegExp[] = [
  /^localhost$/,
  /^127\.\d+\.\d+\.\d+$/,
  /^10\.\d+\.\d+\.\d+$/,
  /^192\.168\.\d+\.\d+$/,
  /^169\.254\.\d+\.\d+$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/,
  /^\[?fe80:/,
  /\.local$/,
];

/**
 * If `host` is the canonical (post-`URL`-normalization) form of an
 * IPv4-mapped IPv6 address — `::ffff:<hex>:<hex>`, e.g. the `[::ffff:7f00:1]`
 * Node produces for `[::ffff:127.0.0.1]` — decode the embedded IPv4 address
 * so it can be re-checked against the IPv4 denylist patterns above.
 * Otherwise returns null.
 */
function decodeIpv4MappedHost(host: string): string | null {
  const match = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(host);
  if (!match) {
    return null;
  }
  const high = Number.parseInt(match[1], 16);
  const low = Number.parseInt(match[2], 16);
  return [(high >> 8) & 0xff, high & 0xff, (low >> 8) & 0xff, low & 0xff].join(
    ".",
  );
}

/**
 * SSRF guard for `workspace_browse`: the URL is agent/model-supplied and
 * reaches a server-side fetch (OWASP SSRF), so it must be validated as a
 * plain public http(s) URL before anything is fetched.
 */
export function assertSafeHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`SEC_SSRF_INVALID_URL: invalid URL '${raw}'.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `SEC_SSRF_SCHEME: invalid URL scheme '${url.protocol}' — only http/https are supported.`,
    );
  }

  const host = url.hostname.toLowerCase();
  const mappedIpv4 = decodeIpv4MappedHost(host);
  const isBlocked =
    BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(host)) ||
    (mappedIpv4 !== null &&
      BLOCKED_HOSTNAME_PATTERNS.some((re) => re.test(mappedIpv4)));
  if (isBlocked) {
    throw new Error(
      `SEC_SSRF_PRIVATE_HOST: invalid target host '${host}' — private, loopback and link-local hosts are blocked.`,
    );
  }

  return url;
}

/**
 * Deterministic filename for an ingested page: a readable slug of
 * `hostname + pathname`, suffixed with a short hash of the FULL url (query
 * string included) so two distinct URLs that happen to share a slug never
 * collide, and re-ingesting the SAME url always resolves to the SAME file
 * (an upsert via `workspace_browse` re-running, not a growing pile of
 * near-duplicates).
 */
export function slugifyUrl(url: URL): string {
  const base = `${url.hostname}${url.pathname}`.toLowerCase();
  const cleaned =
    base
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "page";
  const hash = createHash("sha256")
    .update(url.toString())
    .digest("hex")
    .slice(0, 8);
  return `${cleaned}-${hash}`;
}
