import store from "../../../store";
import { getProxyInfoFromUrl } from "../proxyInfo";
import { strikeAutoProxy } from "./manager";

/*
 * Ties what the page script sees (ads, Twitch's USER-COUNTRY) back to the
 * proxy that carried that response. The page can't know which proxy was
 * used, and the background can't read response bodies, so the background
 * remembers which proxy served each response and the page reports what was
 * in it.
 *
 *   onResponseStarted ── url → "host:port" ──► recent map
 *   page script ──── ad in url / country ────► lookup ─► strikeAutoProxy
 *
 * In-memory only: the correlation window is seconds, and losing it when the
 * background unloads only means a missed strike.
 */

const CORRELATION_WINDOW_MS = 15000;
const MAX_TRACKED = 200;

interface Served {
  proxy: string; // `host:port`
  at: number;
}

const weaverResponses = new Map<string, Served>();
const usherResponsesByChannel = new Map<string, Served>();

function remember(map: Map<string, Served>, key: string, proxy: string | null) {
  map.delete(key);
  if (!proxy) return;
  map.set(key, { proxy, at: Date.now() });
  if (map.size > MAX_TRACKED) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

function recall(map: Map<string, Served>, key: string): string | null {
  const served = map.get(key);
  if (!served || Date.now() - served.at > CORRELATION_WINDOW_MS) return null;
  return served.proxy;
}

function isAutoProxy(hostPort: string): boolean {
  return store.state.autoProxies.some(entry => {
    const { host, port } = getProxyInfoFromUrl(entry.url);
    return `${host}:${port}` === hostPort;
  });
}

export function recordProxiedVideoWeaverResponse(
  url: string,
  proxy: string | null
) {
  remember(weaverResponses, url, proxy);
}

export function recordProxiedUsherResponse(
  channel: string | null,
  proxy: string | null
) {
  if (!channel) return;
  remember(usherResponsesByChannel, channel.toLowerCase(), proxy);
}

/**
 * The page script found a stitched ad in a Video Weaver response.
 * Counts against the proxy only if that response came through one of ours.
 */
export function onAdInVideoWeaverResponse(url: string) {
  const proxy = recall(weaverResponses, url);
  if (!proxy || !isAutoProxy(proxy)) return;
  strikeAutoProxy(proxy, "ad served through this proxy");
}

/**
 * The page script read Twitch's USER-COUNTRY from an Usher response. If that
 * response came through one of ours and Twitch placed it outside the allowed
 * countries, the proxy is useless for ads, whatever the list said.
 */
export function onUsherCountry(
  channel: string | null,
  country: string | undefined
) {
  if (!channel || !country) return;
  const proxy = recall(usherResponsesByChannel, channel.toLowerCase());
  if (!proxy || !isAutoProxy(proxy)) return;
  const upper = country.toUpperCase();
  if (store.state.autoProxyCountries.includes(upper)) return;
  strikeAutoProxy(proxy, `Twitch placed it in ${upper}`, true);
}
