import { Mutex } from "async-mutex";
import browser from "webextension-polyfill";
import store from "../../../store";
import type {
  AutoProxyEntry,
  AutoProxyRefreshReason,
  AutoProxyStatus,
} from "../../../types";
import isChromium from "../isChromium";
import { getProxyInfoFromUrl } from "../proxyInfo";
import { updateProxySettings } from "../proxySettings";
import {
  AUTO_PROXY_LOW_WATERMARK,
  AUTO_PROXY_MAX_PROBES_PER_REFRESH,
  AUTO_PROXY_MAX_STRIKES,
  AUTO_PROXY_PROBE_CONCURRENCY_FIREFOX,
  AUTO_PROXY_REFRESH_PERIOD_MINUTES,
  AUTO_PROXY_REJECT_COOLDOWN_MS,
  MAX_AUTO_PROXY_POOL_SIZE,
  MIN_AUTO_PROXY_POOL_SIZE,
} from "./constants";
import {
  getDirectIp,
  getLiveChannels,
  probeCandidate,
  type ProbeContext,
  type ProbeResult,
} from "./probe";
import {
  fetchProxyLists,
  selectCandidates,
  type ProxyCandidate,
} from "./source";

const mutex = new Mutex();
let queuedRerun: Promise<AutoProxyStatus> | null = null;

/** Entries checked more recently than this are not re-probed on a refresh. */
const RECHECK_AFTER_MS = 1000 * 60 * (AUTO_PROXY_REFRESH_PERIOD_MINUTES - 5);

/** At most this many pool entries may share one exit IP (backconnect gateways list many ports). */
const MAX_ENTRIES_PER_EXIT_IP = 2;

/** Keeps an MV3 service worker / MV2 event page alive during a refresh. */
const KEEPALIVE_INTERVAL_MS = 20000;

const LOW_POOL_REFRESH_DELAY_MS = 5000;
let lowPoolRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function log(message: string, ...args: unknown[]) {
  console.log(`🛰️ [AutoProxy] ${message}`, ...args);
}

function setStatus(patch: Partial<AutoProxyStatus>) {
  store.state.autoProxyStatus = {
    ...store.state.autoProxyStatus,
    ...patch,
    updatedAt: Date.now(),
  };
}

function hostPortOf(url: string): string {
  const { host, port } = getProxyInfoFromUrl(url);
  return `${host}:${port}`;
}

function getPoolSize(): number {
  const size = Math.round(store.state.autoProxyPoolSize);
  if (!Number.isFinite(size)) return MIN_AUTO_PROXY_POOL_SIZE;
  return Math.min(
    MAX_AUTO_PROXY_POOL_SIZE,
    Math.max(MIN_AUTO_PROXY_POOL_SIZE, size)
  );
}

function isRejected(url: string, now = Date.now()): boolean {
  const until = store.state.autoProxyRejected[url];
  return until != null && until > now;
}

function reject(url: string, why: string) {
  store.state.autoProxyRejected = {
    ...store.state.autoProxyRejected,
    [url]: Date.now() + AUTO_PROXY_REJECT_COOLDOWN_MS,
  };
  log(
    `Excluding ${url} for ${AUTO_PROXY_REJECT_COOLDOWN_MS / 3600000}h: ${why}`
  );
}

function pruneRejected() {
  const now = Date.now();
  const kept = Object.fromEntries(
    Object.entries(store.state.autoProxyRejected).filter(
      ([, until]) => until > now
    )
  );
  if (
    Object.keys(kept).length !==
    Object.keys(store.state.autoProxyRejected).length
  ) {
    store.state.autoProxyRejected = kept;
  }
}

/**
 * Writes the pool and pushes it to Chromium's PAC script if a Twitch tab is
 * using it. Firefox reads the pool per request, so it needs nothing more.
 */
function savePool(entries: AutoProxyEntry[]) {
  const sorted = [...entries].sort(
    (a, b) => a.strikes - b.strikes || a.latencyMs - b.latencyMs
  );
  const before = store.state.autoProxies.map(entry => entry.url).join(",");
  store.state.autoProxies = sorted;
  const after = sorted.map(entry => entry.url).join(",");
  if (before !== after && isChromium && store.state.chromiumProxyActive) {
    updateProxySettings();
  }
}

function startKeepalive(): () => void {
  const timer = setInterval(() => {
    browser.runtime.getPlatformInfo().catch(() => {});
  }, KEEPALIVE_INTERVAL_MS);
  return () => clearInterval(timer);
}

/**
 * Runs `probe` over `items` with at most `concurrency` in flight, stopping
 * early once `shouldStop` says so. Results arrive in completion order.
 */
async function probeAll<T>(
  items: T[],
  concurrency: number,
  probe: (item: T) => Promise<void>,
  shouldStop: () => boolean
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length && !shouldStop()) {
        const item = items[next++];
        await probe(item);
      }
    }
  );
  await Promise.all(workers);
}

function describeFailure(result: Exclude<ProbeResult, { ok: true }>): string {
  return `${result.stage}: ${result.reason}`;
}

/**
 * Rechecks the pool, then tops it up from the proxy list until it holds
 * `autoProxyPoolSize` verified proxies.
 *
 * Concurrent calls coalesce: a refresh already running covers them, except
 * a manual one, which waits and runs again.
 */
export async function refreshAutoProxies(
  reason: AutoProxyRefreshReason
): Promise<AutoProxyStatus> {
  if (mutex.isLocked()) {
    if (reason !== "manual" && reason !== "settings") {
      log(`Refresh (${reason}) skipped: one is already running`);
      return store.state.autoProxyStatus;
    }
    // One queued rerun picks up every settings change made meanwhile.
    if (queuedRerun) return queuedRerun;
    queuedRerun = mutex.runExclusive(() => {
      queuedRerun = null;
      return runRefresh(reason);
    });
    return queuedRerun;
  }
  return mutex.runExclusive(() => runRefresh(reason));
}

async function runRefresh(
  reason: AutoProxyRefreshReason
): Promise<AutoProxyStatus> {
  if (store.readyState !== "complete") {
    await new Promise<void>(resolve => store.addEventListener("load", resolve));
  }
  if (!store.state.autoProxiesEnabled) {
    setStatus({ state: "idle", message: "Automatic proxies are off.", reason });
    return store.state.autoProxyStatus;
  }

  const stopKeepalive = startKeepalive();
  const controller = new AbortController();
  const countries = new Set(store.state.autoProxyCountries);
  const poolSize = getPoolSize();
  let tested = 0;

  try {
    pruneRejected();
    setStatus({
      state: "fetching",
      message: "Finding live channels to test with…",
      reason,
      tested: 0,
      accepted: 0,
    });

    let channels: string[];
    try {
      channels = await getLiveChannels(controller.signal);
    } catch (error) {
      throw new Error(
        `Twitch unreachable: ${error instanceof Error ? error.message : error}`
      );
    }
    // Chromium: only meaningful while our PAC script isn't routing GQL.
    const directIp =
      !isChromium || !store.state.chromiumProxyActive
        ? await getDirectIp(channels[0], controller.signal)
        : null;
    const context: ProbeContext = { channels, countries, directIp };

    // 1. Recheck the pool: drop proxies that stopped working or that are
    //    outside the (possibly changed) country selection.
    let pool = store.state.autoProxies.filter(entry => {
      if (countries.has(entry.twitchCountry)) return true;
      log(`Dropping ${entry.url}: ${entry.twitchCountry} no longer selected`);
      return false;
    });
    const due = pool.filter(
      entry =>
        reason === "manual" ||
        Date.now() - entry.lastCheckedAt > RECHECK_AFTER_MS
    );
    if (due.length > 0) {
      setStatus({
        state: "probing",
        message: `Rechecking ${due.length} proxies…`,
      });
    }
    const dueResults = new Map<string, ProbeResult>();
    await probeAll(
      due,
      isChromium ? 1 : AUTO_PROXY_PROBE_CONCURRENCY_FIREFOX,
      async entry => {
        const candidate: ProxyCandidate = {
          url: entry.url,
          ...splitUrl(entry.url),
          country: entry.twitchCountry,
          countrySource: "twitch",
          httpsCapable: true,
          latencyMs: entry.latencyMs,
          uptime24h: null,
        };
        dueResults.set(
          entry.url,
          await probeCandidate(candidate, context, controller.signal)
        );
        tested++;
      },
      () => controller.signal.aborted
    );
    pool = pool.flatMap(entry => {
      const result = dueResults.get(entry.url);
      if (!result) return [entry];
      if (result.ok) {
        return [
          {
            ...entry,
            twitchCountry: result.twitchCountry,
            exitIp: result.exitIp,
            latencyMs: result.latencyMs,
            lastCheckedAt: Date.now(),
          },
        ];
      }
      if (result.inconclusive) return [entry];
      reject(entry.url, `recheck failed (${describeFailure(result)})`);
      return [];
    });
    savePool(pool);

    // 2. Top up from the list.
    if (pool.length < poolSize) {
      setStatus({ state: "fetching", message: "Downloading proxy list…" });
      const list = await fetchProxyLists(store.state.autoProxySourceUrls);
      const inPool = new Set(pool.map(entry => entry.url));
      const candidates = selectCandidates(
        list.candidates,
        [...countries],
        url => inPool.has(url) || isRejected(url)
      ).slice(0, AUTO_PROXY_MAX_PROBES_PER_REFRESH);
      log(
        `List ${list.sourceUrl}: ${list.listSize} entries, ${list.skippedMalformed} malformed, ${candidates.length} candidates in ${[...countries].join(",")}`
      );
      setStatus({
        state: "probing",
        message: `Testing ${candidates.length} proxies against Twitch…`,
        listSize: list.listSize,
        candidates: candidates.length,
      });

      const exitIpCounts = new Map<string, number>();
      for (const entry of pool) {
        if (entry.exitIp)
          exitIpCounts.set(
            entry.exitIp,
            (exitIpCounts.get(entry.exitIp) ?? 0) + 1
          );
      }
      let postponed = false;

      await probeAll(
        candidates,
        isChromium ? 1 : AUTO_PROXY_PROBE_CONCURRENCY_FIREFOX,
        async candidate => {
          // Chromium: a Twitch tab needs the PAC script; stop and retry later.
          if (isChromium && store.state.chromiumProxyActive) {
            postponed = true;
            return;
          }
          const result = await probeCandidate(
            candidate,
            context,
            controller.signal
          );
          tested++;
          setStatus({ tested, accepted: pool.length });
          if (!result.ok) {
            if (result.inconclusive) {
              if (isChromium) postponed = true;
              return;
            }
            reject(candidate.url, describeFailure(result));
            return;
          }
          if (pool.length >= poolSize) return;
          const sameExit = result.exitIp
            ? (exitIpCounts.get(result.exitIp) ?? 0)
            : 0;
          if (result.exitIp && sameExit >= MAX_ENTRIES_PER_EXIT_IP) {
            log(
              `Skipping ${candidate.url}: exit IP ${result.exitIp} already used ${sameExit}x`
            );
            return;
          }
          if (result.exitIp) exitIpCounts.set(result.exitIp, sameExit + 1);
          const now = Date.now();
          pool.push({
            url: candidate.url,
            listedCountry: candidate.country ?? "",
            twitchCountry: result.twitchCountry,
            exitIp: result.exitIp,
            latencyMs: result.latencyMs,
            addedAt: now,
            lastCheckedAt: now,
            strikes: 0,
          });
          log(
            `Accepted ${candidate.url} (Twitch: ${result.twitchCountry}, ${result.latencyMs}ms)`
          );
          savePool(pool);
          setStatus({ accepted: pool.length });
        },
        () => pool.length >= poolSize || postponed || controller.signal.aborted
      );
      if (postponed)
        log("Probing postponed: a Twitch tab is using the proxy settings");
    }

    savePool(pool);
    store.state.autoProxyLastRefresh = Date.now();
    const countriesInPool = [
      ...new Set(pool.map(entry => entry.twitchCountry)),
    ].join(", ");
    setStatus({
      state: "idle",
      message:
        pool.length === 0
          ? "No working proxy in the selected countries right now. Will retry automatically."
          : `${pool.length} working ${pool.length === 1 ? "proxy" : "proxies"} (${countriesInPool}).`,
      tested,
      accepted: pool.length,
    });
    log(store.state.autoProxyStatus.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : `${error}`;
    console.error(`🛰️ [AutoProxy] Refresh failed: ${message}`);
    setStatus({ state: "error", message, tested });
  } finally {
    controller.abort();
    stopKeepalive();
  }
  return store.state.autoProxyStatus;
}

function splitUrl(
  url: string
): Pick<ProxyCandidate, "protocol" | "host" | "port"> {
  const { type, host, port } = getProxyInfoFromUrl(url);
  return { protocol: type as ProxyCandidate["protocol"], host, port };
}

/**
 * Real-playback evidence against an active proxy. `hostPort` is the form
 * `onResponseStarted` reports (`host:port`, no scheme).
 *
 * `immediate` drops it at once (e.g. Twitch placed it in a disallowed
 * country); otherwise it's dropped after `AUTO_PROXY_MAX_STRIKES`.
 */
export function strikeAutoProxy(
  hostPort: string,
  why: string,
  immediate = false
) {
  const index = store.state.autoProxies.findIndex(
    entry => hostPortOf(entry.url) === hostPort
  );
  if (index === -1) return;
  const entry = store.state.autoProxies[index];
  const strikes = entry.strikes + 1;
  const pool = [...store.state.autoProxies];

  if (immediate || strikes >= AUTO_PROXY_MAX_STRIKES) {
    pool.splice(index, 1);
    reject(entry.url, `${why} (strike ${strikes})`);
  } else {
    pool[index] = { ...entry, strikes };
    log(`Strike ${strikes}/${AUTO_PROXY_MAX_STRIKES} for ${entry.url}: ${why}`);
  }
  savePool(pool);

  if (pool.length < AUTO_PROXY_LOW_WATERMARK) scheduleLowPoolRefresh();
}

function scheduleLowPoolRefresh() {
  if (lowPoolRefreshTimer) return;
  lowPoolRefreshTimer = setTimeout(() => {
    lowPoolRefreshTimer = null;
    refreshAutoProxies("lowPool");
  }, LOW_POOL_REFRESH_DELAY_MS);
}
