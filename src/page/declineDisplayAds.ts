import findChannelFromTwitchTvUrl from "../common/ts/findChannelFromTwitchTvUrl";
import Logger from "../common/ts/Logger";
import type { PageState } from "./types";

/*
 * Display ads (the pod above chat, squeezeback, lower third, pause ads) are
 * decided in the browser, not stitched into the stream, so the playlist
 * handling never sees them. Twitch's client-side ad manager drains its
 * request queue as
 *
 *   this.declineReason ? cmd.decline(this.declineReason) : this.isReady && cmd.fn()
 *
 * where `cmd.fn()` is the request to the ad exchange. Setting a decline
 * reason through the manager's own `decline()` stops those requests before
 * they leave, with `{ sendEvent: false }`, Twitch's own switch for not
 * reporting the decline.
 *
 * Approach from scamorza/TwitchAdBlock (MIT). The manager is found through
 * webpack's module registry by the names of its static methods, which
 * minification keeps, so no module ID or bundle hash is hard-coded.
 */

const logger = new Logger("DisplayAds");

// A reason from Twitch's own enum: it's passed to every declined command and
// tracked from there, so an invented string would stand out.
const DECLINE_REASON = "player_size";
// The bundle defining the manager can take ~20s on a cold cache.
const ATTEMPT_INTERVAL_MS = 500;
const MAX_ATTEMPTS = 240;

type WebpackRequire = ((id: string) => any) & { m?: Record<string, Function> };

interface AdManager {
  declineReason?: string | null;
  decline(reason: string, options?: { sendEvent?: boolean }): void;
  startProcessingRequests(): void;
}

function getWebpackRequire(): WebpackRequire | null {
  const key = Object.keys(window).find(name => /^webpackChunk/i.test(name));
  const queue = key ? (window as any)[key] : null;
  if (!queue || typeof queue.push !== "function") return null;
  // Webpack's runtime calls the callback synchronously, but only once it owns
  // the array; before that this is a plain append, which must be undone.
  let webpackRequire: WebpackRequire | null = null;
  const entry = [
    [Symbol("ttv-lol-pro")],
    {},
    (r: WebpackRequire) => {
      webpackRequire = r;
    },
  ];
  queue.push(entry);
  if (!webpackRequire) {
    const index = queue.indexOf(entry);
    if (index !== -1) queue.splice(index, 1);
    return null;
  }
  return webpackRequire;
}

function findAdManager(webpackRequire: WebpackRequire): AdManager | null {
  const factories = webpackRequire.m ?? {};
  for (const id of Object.keys(factories)) {
    let source: string;
    try {
      source = Function.prototype.toString.call(factories[id]);
    } catch {
      continue;
    }
    // Both markers: the component that calls startProcessingRequests has the
    // first alone and doesn't hold the class.
    if (
      !source.includes("startProcessingRequests") ||
      !source.includes("declineReason")
    ) {
      continue;
    }
    let exports: any;
    try {
      exports = webpackRequire(id);
    } catch {
      continue;
    }
    if (!exports) continue;
    for (const name of Object.keys(exports)) {
      let value: any;
      try {
        value = exports[name];
      } catch {
        continue;
      }
      if (
        typeof value === "function" &&
        typeof value.startProcessingRequests === "function" &&
        typeof value.decline === "function"
      ) {
        return value as AdManager;
      }
    }
  }
  return null;
}

type AttemptResult = "declined" | "already" | "notFound";

function tryDecline(): AttemptResult {
  const webpackRequire = getWebpackRequire();
  if (!webpackRequire) return "notFound";
  const manager = findAdManager(webpackRequire);
  if (!manager) return "notFound";
  if (manager.declineReason) {
    logger.log(
      `Display ads already declined by Twitch (${manager.declineReason}).`
    );
    return "already";
  }
  manager.decline(DECLINE_REASON, { sendEvent: false });
  if (!manager.declineReason) {
    logger.warn("Found Twitch's ad manager, but the decline didn't take.");
    return "notFound";
  }
  logger.log("Display ads declined: Twitch won't request them this session.");
  return "declined";
}

/**
 * Declines Twitch's client-side display ads for this page session, unless
 * the user turned it off or the channel being watched is whitelisted (so
 * whitelisting keeps supporting the streamer). A decline lasts until the
 * page reloads.
 */
export default function startDecliningDisplayAds(pageState: PageState) {
  let attempts = 0;
  const attempt = () => {
    attempts++;
    const state = pageState.state;
    // Wait for the settings; they arrive long before Twitch's ad bundle.
    if (state != null) {
      if (state.declineDisplayAds === false) return;
      const channelName = findChannelFromTwitchTvUrl(location.href);
      const isWhitelisted =
        channelName != null &&
        state.whitelistedChannels.some(
          channel => channel.toLowerCase() === channelName.toLowerCase()
        );
      if (isWhitelisted) {
        logger.log(
          `Not declining display ads: '${channelName}' is whitelisted.`
        );
        return;
      }
      let result: AttemptResult = "notFound";
      try {
        result = tryDecline();
      } catch (error) {
        logger.debug("Ad manager lookup failed:", error);
      }
      if (result !== "notFound") return;
    }
    if (attempts >= MAX_ATTEMPTS) {
      logger.warn(
        `Twitch's ad manager not found after ${attempts} attempts: display ads are not blocked.`
      );
      return;
    }
    setTimeout(attempt, ATTEMPT_INTERVAL_MS);
  };
  attempt();
}
