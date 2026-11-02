/**
 * Countries where Twitch shows no (or almost no) livestream ads.
 *
 * Source: TTV LOL PRO knowledge base, "List of known ad-free countries"
 * (https://wiki.cdn-perfprod.com/guides/proxy/host-your-own-proxy), read
 * 2026-11-02. The wiki's definitions:
 * - ad-free: no records of ads over the last 12 months;
 * - partially ad-free: 1-2 ads recorded over the last 12 months.
 *
 * ISO 3166-1 alpha-2 codes, matching Twitch's `USER-COUNTRY` attribute.
 */
export const AD_FREE_COUNTRIES: readonly string[] = Object.freeze([
  "RU", // Limited to 720p since 2025-06-23.
  "KR", // Limited to 720p.
  "AL",
  "MD",
  "BY",
  "RO",
  "LV",
  "LT",
  "EE",
  "BG",
  "SI",
  "IS",
  "PT",
  "HR",
  "MK",
  "GE",
  "AM",
  "KZ",
  "SC",
]);

export const PARTIALLY_AD_FREE_COUNTRIES: readonly string[] = Object.freeze([
  "UA",
  "SK",
  "LU",
  "AE",
  "RS",
  "PL",
  "EG",
  "IL",
]);

export const QUALITY_LIMITED_COUNTRIES: Readonly<Record<string, string>> =
  Object.freeze({
    RU: "720p",
    KR: "720p",
  });

export function getDefaultAutoProxyCountries(): string[] {
  return [...AD_FREE_COUNTRIES];
}

/**
 * Proxy lists produced by proxy-scraper (https://github.com/maximilianfeix/proxy-scraper),
 * downloaded together and merged (see `fetchProxyLists`). Both are rebuilt
 * about every hour and send `Access-Control-Allow-Origin: *`.
 *
 * 1. `twitch.json`: the hourly list re-checked against Twitch's stream CDN,
 *    with the country Twitch reports (`twitch_country`). Small (~30-40
 *    proxies), but most of it passes our own probe.
 * 2. `proxies.json`: the full hourly list with GeoIP countries, as fallback.
 */
export const DEFAULT_AUTO_PROXY_SOURCE_URLS: readonly string[] = Object.freeze([
  "https://raw.githubusercontent.com/coffeegrind123/proxy-scraper/twitch-list/twitch.json",
  "https://proxy-scraper.de/proxies.json",
]);

export const DEFAULT_AUTO_PROXY_POOL_SIZE = 5;
export const MIN_AUTO_PROXY_POOL_SIZE = 1;
export const MAX_AUTO_PROXY_POOL_SIZE = 20;

/** Refill the pool in the background once fewer than this many remain. */
export const AUTO_PROXY_LOW_WATERMARK = 3;

/** How often the pool is rechecked and topped up. */
export const AUTO_PROXY_ALARM_NAME = "tlp-auto-proxy-refresh";
export const AUTO_PROXY_REFRESH_PERIOD_MINUTES = 30;

/** Strikes after which an active proxy is dropped from the pool. */
export const AUTO_PROXY_MAX_STRIKES = 2;

/** How long a proxy that failed a probe or was dropped stays excluded. */
export const AUTO_PROXY_REJECT_COOLDOWN_MS = 1000 * 60 * 60 * 6; // 6 hours

/** Probe limits. */
export const AUTO_PROXY_PROBE_STEP_TIMEOUT_MS = 8000;
export const AUTO_PROXY_PROBE_CONCURRENCY_FIREFOX = 8;
export const AUTO_PROXY_MAX_PROBES_PER_REFRESH = 60;

/**
 * Query parameter that marks the extension's own probe requests, so the
 * proxy handlers can route them through the candidate proxy and the
 * monitoring handlers can ignore them. Twitch's GQL, Usher and Video Weaver
 * endpoints ignore unknown query parameters (verified 2026-11-02).
 */
export const AUTO_PROXY_PROBE_PARAM = "tlp_probe";

/** Twitch's public web client ID, also used by the page script. */
export const TWITCH_WEB_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko";

/**
 * Same `PlaybackAccessToken_Template` query the page script sends (see
 * `getDefaultPlaybackAccessTokenQueryAndHeaders` in `page/getFetch.ts`).
 * Sent as a full query rather than a persisted-query hash, which Twitch
 * rotates.
 */
export const PLAYBACK_ACCESS_TOKEN_QUERY =
  'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!, $platform: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature   authorization { isForbidden forbiddenReasonCode }   __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: $platform, playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature   __typename  }}';

/** Most-watched live channels, used as probe targets (always live). */
export const LIVE_CHANNELS_QUERY =
  "query { streams(first: 20, options: {sort: VIEWER_COUNT}) { edges { node { broadcaster { login } } } } }";
