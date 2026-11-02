import type { ProxyInfo } from "../../../types";
import generateRandomString, { Charset } from "../generateRandomString";
import isChromium from "../isChromium";
import { getProxyInfoFromUrl } from "../proxyInfo";
import { runWithChromiumProbePac } from "../proxySettings";
import {
  AUTO_PROXY_PROBE_PARAM,
  AUTO_PROXY_PROBE_STEP_TIMEOUT_MS,
  LIVE_CHANNELS_QUERY,
  PLAYBACK_ACCESS_TOKEN_QUERY,
  TWITCH_WEB_CLIENT_ID,
} from "./constants";
import type { ProxyCandidate } from "./source";

/*
 * What a probe can and cannot tell.
 *
 *   token (GQL) ──► usher (master playlist) ──► video weaver (media playlist)
 *        │                  │                          │
 *     user_ip         USER-COUNTRY, 403            #EXTINF present
 *
 * Every step goes through the candidate proxy. A probe proves the proxy is
 * reachable from this browser, gets past Twitch's CDN (CloudFront answers
 * most public proxies with a 403 page on usher even with a valid token), and
 * exits in a country Twitch places in the allowed set.
 *
 * It does NOT prove the proxy is ad-free: measured 2026-11-02, a request
 * without a device ID gets the same 30s house preroll in every country, and
 * one with a fresh device ID gets none in any country, ad-free or not. Ad
 * freedom is judged from real playback instead (see `reportProxiedAd`).
 */

export type ProbeStage = "token" | "usher" | "weaver" | "country" | "leak";

export type ProbeResult =
  | {
      ok: true;
      twitchCountry: string;
      exitIp: string | null;
      latencyMs: number;
    }
  | {
      ok: false;
      stage: ProbeStage;
      reason: string;
      twitchCountry?: string;
      // Inconclusive results (channel went offline, probe cancelled) say
      // nothing about the proxy and must not put it on cooldown.
      inconclusive?: boolean;
    };

export interface ProbeContext {
  channels: string[];
  countries: Set<string>;
  directIp: string | null; // Our own IP as Twitch sees it, when known.
}

const USER_COUNTRY_REGEX = /USER-COUNTRY="([A-Z]{2})"/i;
const USER_COUNTRY_V2_REGEX = /"USER-COUNTRY",VALUE="([A-Z]{2})"/i;

//#region Firefox routing
// Probe ID → proxy. `onProxyRequest` routes any request carrying
// `?tlp_probe=<id>` through that proxy and nothing else (no DIRECT fallback,
// which would make a dead proxy look alive).
const firefoxProbeRoutes = new Map<string, ProxyInfo>();

export function getProbeIdFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get(AUTO_PROXY_PROBE_PARAM);
  } catch {
    return null;
  }
}

export function isProbeRequestUrl(url: string): boolean {
  return getProbeIdFromUrl(url) != null;
}

/**
 * Firefox only: the proxy a probe request must use, or null if `url` is not
 * a probe request. An unknown probe ID (probe already finished) is routed
 * nowhere useful on purpose: `{ type: "direct" }` would leak the probe.
 */
export function getFirefoxProbeRoute(url: string): ProxyInfo[] | null {
  const probeId = getProbeIdFromUrl(url);
  if (probeId == null) return null;
  const route = firefoxProbeRoutes.get(probeId);
  if (!route) {
    // 127.0.0.1:9 (discard) fails fast; better than an unproxied probe.
    return [{ type: "http", host: "127.0.0.1", port: 9 }];
  }
  return [route];
}
//#endregion

function withProbeParam(url: string, probeId: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(AUTO_PROXY_PROBE_PARAM, probeId);
  return parsed.toString();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);
  const timeout = setTimeout(
    () => controller.abort(),
    AUTO_PROXY_PROBE_STEP_TIMEOUT_MS
  );
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
  }
}

function describeError(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) return "cancelled";
  if (error instanceof DOMException && error.name === "AbortError") {
    return `timed out after ${AUTO_PROXY_PROBE_STEP_TIMEOUT_MS}ms`;
  }
  return error instanceof Error ? error.message : `${error}`;
}

function twitchHeaders(): Record<string, string> {
  const deviceId = generateRandomString(32, Charset.ALPHANUMERIC_LOWERCASE);
  return {
    "Client-ID": TWITCH_WEB_CLIENT_ID,
    "Content-Type": "text/plain; charset=UTF-8",
    "Device-ID": deviceId,
    "X-Device-Id": deviceId,
  };
}

interface PlaybackToken {
  value: string;
  signature: string;
  userIp: string | null;
}

async function getPlaybackToken(
  channel: string,
  gqlUrl: string,
  signal: AbortSignal
): Promise<PlaybackToken> {
  const response = await fetchWithTimeout(
    gqlUrl,
    {
      method: "POST",
      headers: twitchHeaders(),
      body: JSON.stringify({
        operationName: "PlaybackAccessToken_Template",
        query: PLAYBACK_ACCESS_TOKEN_QUERY,
        variables: {
          isLive: true,
          isVod: false,
          login: channel,
          platform: "web",
          playerType: "site",
          vodID: "",
        },
      }),
    },
    signal
  );
  if (!response.ok) throw new Error(`GQL HTTP ${response.status}`);
  const body = await response.text();
  let token: { value?: string; signature?: string } | undefined;
  try {
    token = JSON.parse(body)?.data?.streamPlaybackAccessToken;
  } catch {
    throw new Error(
      `GQL returned non-JSON (head: ${JSON.stringify(body.slice(0, 60))})`
    );
  }
  if (!token?.value || !token.signature) {
    throw new Error(
      `GQL returned no token (head: ${JSON.stringify(body.slice(0, 80))})`
    );
  }
  let userIp: string | null = null;
  try {
    userIp = JSON.parse(token.value)?.user_ip ?? null;
  } catch {}
  return { value: token.value, signature: token.signature, userIp };
}

/**
 * Twitch's most-watched live channels, fetched without a proxy.
 */
export async function getLiveChannels(signal: AbortSignal): Promise<string[]> {
  const response = await fetchWithTimeout(
    "https://gql.twitch.tv/gql",
    {
      method: "POST",
      headers: twitchHeaders(),
      body: JSON.stringify({ query: LIVE_CHANNELS_QUERY }),
    },
    signal
  );
  if (!response.ok)
    throw new Error(`live channels: GQL HTTP ${response.status}`);
  const data = await response.json();
  const edges: any[] = data?.data?.streams?.edges ?? [];
  const logins = edges
    .map(edge => edge?.node?.broadcaster?.login)
    .filter((login): login is string => typeof login === "string" && !!login);
  if (logins.length === 0) {
    throw new Error(
      `live channels: none returned (head: ${JSON.stringify(data).slice(0, 80)})`
    );
  }
  return logins;
}

/**
 * Our own IP as Twitch sees it, from a token fetched without a proxy.
 * Used to catch probes that silently bypassed the proxy.
 */
export async function getDirectIp(
  channel: string,
  signal: AbortSignal
): Promise<string | null> {
  try {
    const token = await getPlaybackToken(
      channel,
      "https://gql.twitch.tv/gql",
      signal
    );
    return token.userIp;
  } catch (error) {
    console.warn(
      `[AutoProxy] Direct IP lookup failed: ${describeError(error, signal)}`
    );
    return null;
  }
}

/**
 * Runs the three probe steps through whatever routing the caller set up.
 * Every URL carries the probe marker so monitoring handlers skip it.
 */
async function runProbeSteps(
  probeId: string,
  context: ProbeContext,
  signal: AbortSignal
): Promise<ProbeResult> {
  const startedAt = Date.now();
  let lastOfflineReason = "";

  // A channel can go offline between discovery and probe (usher 404); try a
  // few before calling the result inconclusive.
  for (const channel of context.channels.slice(0, 3)) {
    let token: PlaybackToken;
    try {
      token = await getPlaybackToken(
        channel,
        withProbeParam("https://gql.twitch.tv/gql", probeId),
        signal
      );
    } catch (error) {
      return {
        ok: false,
        stage: "token",
        reason: describeError(error, signal),
        inconclusive: signal.aborted,
      };
    }
    if (context.directIp && token.userIp === context.directIp) {
      return {
        ok: false,
        stage: "leak",
        reason: `Twitch saw our own IP (${token.userIp}); request bypassed the proxy`,
      };
    }

    const usherUrl = new URL(
      `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(channel)}.m3u8`
    );
    usherUrl.searchParams.set("sig", token.signature);
    usherUrl.searchParams.set("token", token.value);
    usherUrl.searchParams.set("allow_source", "true");
    usherUrl.searchParams.set("p", `${Math.floor(Math.random() * 1e7)}`);
    usherUrl.searchParams.set(AUTO_PROXY_PROBE_PARAM, probeId);

    let usherBody: string;
    try {
      const response = await fetchWithTimeout(usherUrl.toString(), {}, signal);
      usherBody = await response.text();
      if (response.status === 404) {
        lastOfflineReason = `channel '${channel}' offline (usher 404)`;
        continue;
      }
      if (!response.ok || !usherBody.startsWith("#EXTM3U")) {
        const blocked = /could not be satisfied|request blocked/i.test(
          usherBody
        );
        return {
          ok: false,
          stage: "usher",
          reason: blocked
            ? `blocked by Twitch's CDN (HTTP ${response.status})`
            : `HTTP ${response.status} (head: ${JSON.stringify(usherBody.slice(0, 40))})`,
        };
      }
    } catch (error) {
      return {
        ok: false,
        stage: "usher",
        reason: describeError(error, signal),
        inconclusive: signal.aborted,
      };
    }

    const twitchCountry = (
      USER_COUNTRY_REGEX.exec(usherBody)?.[1] ??
      USER_COUNTRY_V2_REGEX.exec(usherBody)?.[1] ??
      ""
    ).toUpperCase();
    if (!twitchCountry) {
      return {
        ok: false,
        stage: "country",
        reason: "usher response has no USER-COUNTRY",
      };
    }
    if (!context.countries.has(twitchCountry)) {
      return {
        ok: false,
        stage: "country",
        reason: `Twitch places this proxy in ${twitchCountry}, not an allowed country`,
        twitchCountry,
      };
    }

    const weaverUrl = usherBody
      .split("\n")
      .map(line => line.trim())
      .find(line => line.startsWith("https://"));
    if (!weaverUrl) {
      return {
        ok: false,
        stage: "usher",
        reason: "usher playlist lists no media playlist",
        twitchCountry,
      };
    }
    try {
      const response = await fetchWithTimeout(
        withProbeParam(weaverUrl, probeId),
        {},
        signal
      );
      const body = await response.text();
      if (!response.ok || !body.includes("#EXTINF")) {
        return {
          ok: false,
          stage: "weaver",
          reason: `HTTP ${response.status} (head: ${JSON.stringify(body.slice(0, 40))})`,
          twitchCountry,
        };
      }
    } catch (error) {
      return {
        ok: false,
        stage: "weaver",
        reason: describeError(error, signal),
        twitchCountry,
        inconclusive: signal.aborted,
      };
    }

    // On Chromium a cancelled probe's last request may have gone through the
    // user's PAC script instead of the candidate.
    if (signal.aborted) {
      return {
        ok: false,
        stage: "weaver",
        reason: "cancelled",
        inconclusive: true,
      };
    }
    return {
      ok: true,
      twitchCountry,
      exitIp: token.userIp,
      latencyMs: Date.now() - startedAt,
    };
  }

  return {
    ok: false,
    stage: "usher",
    reason: lastOfflineReason || "no live channel to probe with",
    inconclusive: true,
  };
}

/**
 * Probes one candidate through itself.
 *
 * Firefox routes by the probe marker, so probes can run in parallel.
 * Chromium can only route by host (PAC), so each probe takes over the PAC
 * script for Twitch's hosts and probes run one at a time; opening a Twitch
 * tab cancels the probe (see `runWithChromiumProbePac`).
 */
export async function probeCandidate(
  candidate: ProxyCandidate,
  context: ProbeContext,
  signal: AbortSignal
): Promise<ProbeResult> {
  const probeId = generateRandomString(16, Charset.ALPHANUMERIC_LOWERCASE);

  if (isChromium) {
    try {
      return await runWithChromiumProbePac(candidate.url, probeSignal => {
        const combined = new AbortController();
        const abort = () => combined.abort();
        signal.addEventListener("abort", abort);
        probeSignal.addEventListener("abort", abort);
        return runProbeSteps(probeId, context, combined.signal).finally(() => {
          signal.removeEventListener("abort", abort);
          probeSignal.removeEventListener("abort", abort);
        });
      });
    } catch (error) {
      return {
        ok: false,
        stage: "token",
        reason: error instanceof Error ? error.message : `${error}`,
        inconclusive: true,
      };
    }
  }

  firefoxProbeRoutes.set(probeId, getProxyInfoFromUrl(candidate.url));
  try {
    return await runProbeSteps(probeId, context, signal);
  } finally {
    firefoxProbeRoutes.delete(probeId);
  }
}
