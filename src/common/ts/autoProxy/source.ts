import type { AutoProxyProtocol } from "../../../types";

/**
 * A proxy from a downloaded list, before it has been probed.
 */
export interface ProxyCandidate {
  url: string; // `protocol://host:port` in the extension's own protocol names.
  protocol: AutoProxyProtocol;
  host: string;
  port: number;
  country: string | null; // Twitch-observed when the list provides it, else GeoIP.
  countrySource: "twitch" | "geoip" | "unknown";
  httpsCapable: boolean | null; // null = the list doesn't say.
  latencyMs: number | null;
  uptime24h: number | null; // Percent of the last 24h runs it was listed in.
}

export interface ProxyListResult {
  sourceUrl: string;
  candidates: ProxyCandidate[];
  listSize: number;
  skippedMalformed: number;
  skippedUnsafe: number; // Not a public IPv4 address (see `splitHostPort`).
}

/**
 * proxy-scraper's protocol names → the extension's (`ProxyType`).
 * `socks` is SOCKS5 in both Firefox's `ProxyInfo` and our PAC mapping.
 */
const PROTOCOL_MAP: Readonly<Record<string, AutoProxyProtocol>> = Object.freeze(
  {
    http: "http",
    socks4: "socks4",
    socks5: "socks",
    socks: "socks",
  }
);

const FETCH_TIMEOUT_MS = 20000;
const MAX_LIST_BYTES = 16 * 1024 * 1024;

/**
 * Downloads every list and merges them. A proxy listed with a
 * Twitch-observed country beats the same proxy listed with a GeoIP one, so
 * a small Twitch-checked list goes first and a big general list fills up
 * behind it. Throws with every failure reason only if no list loads.
 */
export async function fetchProxyLists(
  sourceUrls: string[]
): Promise<ProxyListResult> {
  const results = await Promise.allSettled(sourceUrls.map(fetchOne));
  const loaded: ProxyListResult[] = [];
  const failures: string[] = [];
  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      loaded.push(result.value);
      return;
    }
    const reason =
      result.reason instanceof Error
        ? result.reason.message
        : `${result.reason}`;
    console.warn(`[AutoProxy] List ${sourceUrls[index]} failed: ${reason}`);
    failures.push(`${sourceUrls[index]}: ${reason}`);
  });
  if (loaded.length === 0) {
    throw new Error(`No proxy list could be loaded (${failures.join("; ")})`);
  }
  return mergeProxyLists(loaded);
}

const COUNTRY_SOURCE_RANK = { twitch: 0, geoip: 1, unknown: 2 } as const;

export function mergeProxyLists(lists: ProxyListResult[]): ProxyListResult {
  const byUrl = new Map<string, ProxyCandidate>();
  for (const list of lists) {
    for (const candidate of list.candidates) {
      const existing = byUrl.get(candidate.url);
      if (
        !existing ||
        COUNTRY_SOURCE_RANK[candidate.countrySource] <
          COUNTRY_SOURCE_RANK[existing.countrySource]
      ) {
        byUrl.set(candidate.url, candidate);
      }
    }
  }
  return {
    sourceUrl: lists.map(list => list.sourceUrl).join(", "),
    candidates: [...byUrl.values()],
    listSize: lists.reduce((sum, list) => sum + list.listSize, 0),
    skippedMalformed: lists.reduce(
      (sum, list) => sum + list.skippedMalformed,
      0
    ),
    skippedUnsafe: lists.reduce((sum, list) => sum + list.skippedUnsafe, 0),
  };
}

async function fetchOne(sourceUrl: string): Promise<ProxyListResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let text: string;
  try {
    const response = await fetch(sourceUrl, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    text = await response.text();
  } finally {
    clearTimeout(timeout);
  }
  if (text.length > MAX_LIST_BYTES) {
    throw new Error(`list is ${text.length} bytes, over ${MAX_LIST_BYTES}`);
  }
  return parseProxyList(sourceUrl, text);
}

/**
 * Accepts the two formats proxy-scraper publishes:
 * - JSON array of entries (`proxies.json`, `works-with/twitch.json`);
 * - plain text, one `protocol://host:port` per line (`all.txt`, `https.txt`).
 * Bare `host:port` lines are treated as HTTP, as proxy-scraper's `http.txt` is.
 */
export function parseProxyList(
  sourceUrl: string,
  text: string
): ProxyListResult {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("[")) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch (error) {
      throw new Error(
        `invalid JSON (head: ${JSON.stringify(trimmed.slice(0, 60))})`
      );
    }
    if (!Array.isArray(data)) throw new Error("JSON is not an array");
    return fromJsonEntries(sourceUrl, data);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("<")) {
    throw new Error(
      `unrecognised list format (head: ${JSON.stringify(trimmed.slice(0, 60))})`
    );
  }
  return fromTextLines(sourceUrl, text);
}

function fromJsonEntries(sourceUrl: string, data: unknown[]): ProxyListResult {
  const candidates: ProxyCandidate[] = [];
  let skippedMalformed = 0;
  let skippedUnsafe = 0;

  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) {
      skippedMalformed++;
      continue;
    }
    const entry = raw as Record<string, unknown>;

    const protocol = PROTOCOL_MAP[String(entry.ptype ?? "").toLowerCase()];
    const hostPort = splitHostPort(String(entry.proxy ?? ""));
    if (hostPort === "unsafe") {
      skippedUnsafe++;
      continue;
    }
    if (!protocol || hostPort === "malformed") {
      skippedMalformed++;
      continue;
    }
    if (entry.blocklisted === true) continue;

    // `twitch_country` comes from a list built with a Twitch check; it is
    // what Twitch itself reported, so it beats the GeoIP country.
    const twitchCountry = normalizeCountry(entry.twitch_country);
    const geoCountry = normalizeCountry(entry.country);
    candidates.push({
      url: `${protocol}://${hostPort.host}:${hostPort.port}`,
      protocol,
      host: hostPort.host,
      port: hostPort.port,
      country: twitchCountry ?? geoCountry,
      countrySource: twitchCountry
        ? "twitch"
        : geoCountry
          ? "geoip"
          : "unknown",
      httpsCapable: typeof entry.https === "boolean" ? entry.https : null,
      latencyMs: typeof entry.latency === "number" ? entry.latency : null,
      uptime24h: typeof entry.uptime_24h === "number" ? entry.uptime_24h : null,
    });
  }

  if (data.length > 0 && candidates.length === 0 && skippedUnsafe > 0) {
    throw new Error(
      `every entry points at a private or reserved address (${skippedUnsafe}); refusing the list`
    );
  }
  if (data.length > 0 && candidates.length === 0 && skippedMalformed > 0) {
    throw new Error(
      `none of ${data.length} entries had the expected shape (first: ${JSON.stringify(data[0]).slice(0, 120)})`
    );
  }
  return {
    sourceUrl,
    candidates: dedupe(candidates),
    listSize: data.length,
    skippedMalformed,
    skippedUnsafe,
  };
}

function fromTextLines(sourceUrl: string, text: string): ProxyListResult {
  const candidates: ProxyCandidate[] = [];
  let skippedMalformed = 0;
  let skippedUnsafe = 0;
  const lines = text.split(/\r?\n/).map(line => line.trim());
  const nonEmpty = lines.filter(line => line && !line.startsWith("#"));

  for (const line of nonEmpty) {
    let scheme = "http";
    let rest = line;
    const schemeIndex = line.indexOf("://");
    if (schemeIndex !== -1) {
      scheme = line.slice(0, schemeIndex).toLowerCase();
      rest = line.slice(schemeIndex + 3);
    }
    const protocol = PROTOCOL_MAP[scheme];
    const hostPort = splitHostPort(rest);
    if (hostPort === "unsafe") {
      skippedUnsafe++;
      continue;
    }
    if (!protocol || hostPort === "malformed") {
      skippedMalformed++;
      continue;
    }
    candidates.push({
      url: `${protocol}://${hostPort.host}:${hostPort.port}`,
      protocol,
      host: hostPort.host,
      port: hostPort.port,
      country: null,
      countrySource: "unknown",
      httpsCapable: null,
      latencyMs: null,
      uptime24h: null,
    });
  }

  if (nonEmpty.length > 0 && candidates.length === 0 && skippedUnsafe > 0) {
    throw new Error(
      `every entry points at a private or reserved address (${skippedUnsafe}); refusing the list`
    );
  }
  if (nonEmpty.length > 0 && candidates.length === 0) {
    throw new Error(
      `no line looked like a proxy (first: ${JSON.stringify(nonEmpty[0].slice(0, 60))})`
    );
  }
  return {
    sourceUrl,
    candidates: dedupe(candidates),
    listSize: nonEmpty.length,
    skippedMalformed,
    skippedUnsafe,
  };
}

/*
 * IPv4 ranges a proxy from a public list must never be in (IANA IPv4
 * special-purpose registry, RFC 6890 and successors). A list is untrusted
 * input: an entry like 192.168.1.1:80 would make the browser open
 * connections to the user's own router or LAN devices.
 */
const RESERVED_IPV4_RANGES: readonly (readonly [string, number])[] =
  Object.freeze([
    ["0.0.0.0", 8], // "This network"
    ["10.0.0.0", 8], // Private
    ["100.64.0.0", 10], // Carrier-grade NAT
    ["127.0.0.0", 8], // Loopback
    ["169.254.0.0", 16], // Link-local
    ["172.16.0.0", 12], // Private
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // Documentation (TEST-NET-1)
    ["192.88.99.0", 24], // 6to4 relay anycast (deprecated)
    ["192.168.0.0", 16], // Private
    ["198.18.0.0", 15], // Benchmarking
    ["198.51.100.0", 24], // Documentation (TEST-NET-2)
    ["203.0.113.0", 24], // Documentation (TEST-NET-3)
    ["224.0.0.0", 4], // Multicast
    ["240.0.0.0", 4], // Reserved, and 255.255.255.255 broadcast
  ]);

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Decimal only, no leading zeros: "010" is octal to some parsers.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function isPublicIpv4(ip: string): boolean {
  const value = ipv4ToNumber(ip);
  if (value == null) return false;
  return !RESERVED_IPV4_RANGES.some(([base, prefix]) => {
    const size = 2 ** (32 - prefix);
    const start = ipv4ToNumber(base)!;
    return value >= start && value < start + size;
  });
}

/**
 * A public IPv4 address with a port, or why not.
 *
 * Hostnames are refused too: a name can resolve to a private address at
 * connection time (DNS rebinding), and public lists carry IPs anyway.
 * Credentials and IPv6 are refused: lists don't carry either, and IPv6
 * exits can't reach Twitch (IPv4 only).
 */
function splitHostPort(
  value: string
): { host: string; port: number } | "malformed" | "unsafe" {
  const match = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(value.trim());
  if (!match) return "malformed";
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return "malformed";
  const host = match[1].toLowerCase();
  if (!isPublicIpv4(host)) return "unsafe";
  return { host, port };
}

function normalizeCountry(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? upper : null;
}

function dedupe(candidates: ProxyCandidate[]): ProxyCandidate[] {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url);
    return true;
  });
}

/**
 * Keeps what can plausibly work for Twitch, best first.
 *
 * A candidate whose country is unknown is kept: the probe learns its country
 * from Twitch and rejects it if it's outside `countries`.
 */
export function selectCandidates(
  candidates: ProxyCandidate[],
  countries: string[],
  exclude: (url: string) => boolean
): ProxyCandidate[] {
  const allowed = new Set(countries);

  return candidates
    .filter(candidate => candidate.httpsCapable !== false)
    .filter(candidate => !candidate.country || allowed.has(candidate.country))
    .filter(candidate => !exclude(candidate.url))
    .sort(
      (a, b) =>
        COUNTRY_SOURCE_RANK[a.countrySource] -
          COUNTRY_SOURCE_RANK[b.countrySource] ||
        (b.uptime24h ?? 0) - (a.uptime24h ?? 0) ||
        (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity)
    );
}
