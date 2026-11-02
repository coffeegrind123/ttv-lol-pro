import store from "../../store";

/**
 * Proxies to route Twitch requests through, in failover order: verified
 * automatic proxies first (when enabled), then the user's list for the
 * current proxy mode. Callers append the DIRECT fallback themselves.
 *
 * Automatic proxies are picked for ad-free countries, two of which (RU, KR)
 * cap quality at 720p, so "Unlock Best Quality" keeps the user's own list.
 */
export default function getActiveProxies(): string[] {
  const manual = store.state.optimizedProxiesEnabled
    ? store.state.optimizedProxies
    : store.state.normalProxies;
  if (
    !store.state.autoProxiesEnabled ||
    store.state.userExperienceMode === "unlockBestQuality"
  ) {
    return [...manual];
  }
  const auto = store.state.autoProxies.map(entry => entry.url);
  return Array.from(new Set([...auto, ...manual]));
}

/**
 * Every proxy the extension may route through, regardless of mode. Used to
 * recognise proxied responses and to resolve proxy hostnames.
 */
export function getAllKnownProxies(): string[] {
  return Array.from(
    new Set([
      ...store.state.autoProxies.map(entry => entry.url),
      ...store.state.optimizedProxies,
      ...store.state.normalProxies,
    ])
  );
}
