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
 * Downloads the first list that works. Throws with every source's failure
 * reason when none does.
 */
export async function fetchProxyList(
  sourceUrls: string[]
): Promise<ProxyListResult> {
  const failures: string[] = [];
  for (const sourceUrl of sourceUrls) {
    try {
      return await fetchOne(sourceUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.message : `${error}`;
      console.warn(`[AutoProxy] List ${sourceUrl} failed: ${reason}`);
      failures.push(`${sourceUrl}: ${reason}`);
    }
  }
  throw new Error(`No proxy list could be loaded (${failures.join("; ")})`);
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

  for (const raw of data) {
    if (typeof raw !== "object" || raw === null) {
      skippedMalformed++;
      continue;
    }
    const entry = raw as Record<string, unknown>;

    const protocol = PROTOCOL_MAP[String(entry.ptype ?? "").toLowerCase()];
    const hostPort = splitHostPort(String(entry.proxy ?? ""));
    if (!protocol || !hostPort) {
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
  };
}

function fromTextLines(sourceUrl: string, text: string): ProxyListResult {
  const candidates: ProxyCandidate[] = [];
  let skippedMalformed = 0;
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
    if (!protocol || !hostPort) {
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
  };
}

/**
 * IPv4 or hostname with a port. Credentials and IPv6 are rejected: public
 * lists don't carry either, and IPv6 exits can't reach Twitch (IPv4 only).
 */
function splitHostPort(value: string): { host: string; port: number } | null {
  const match = /^([A-Za-z0-9.-]+):(\d{1,5})$/.exec(value.trim());
  if (!match) return null;
  const port = Number(match[2]);
  if (port < 1 || port > 65535) return null;
  return { host: match[1].toLowerCase(), port };
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
  const sourceRank = { twitch: 0, geoip: 1, unknown: 2 } as const;

  return candidates
    .filter(candidate => candidate.httpsCapable !== false)
    .filter(candidate => !candidate.country || allowed.has(candidate.country))
    .filter(candidate => !exclude(candidate.url))
    .sort(
      (a, b) =>
        sourceRank[a.countrySource] - sourceRank[b.countrySource] ||
        (b.uptime24h ?? 0) - (a.uptime24h ?? 0) ||
        (a.latencyMs ?? Infinity) - (b.latencyMs ?? Infinity)
    );
}
