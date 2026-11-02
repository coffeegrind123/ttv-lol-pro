import onStartupStoreCleanup from "../../background/handlers/onStartupStoreCleanup";
import store from "../../store";
import { ProxyRequestType, ProxyType } from "../../types";
import getActiveProxies from "./getActiveProxies";
import isRequestTypeProxied from "./isRequestTypeProxied";
import { getProxyInfoFromUrl, getUrlFromProxyInfo } from "./proxyInfo";
import {
  passportHostRegex,
  twitchGqlHostRegex,
  twitchTvHostRegex,
  usherHostRegex,
  videoWeaverHostRegex,
} from "./regexes";
import updateDnsResponses from "./updateDnsResponses";

const PROXY_TYPE_MAP: Readonly<Record<ProxyType, string>> = Object.freeze({
  direct: "DIRECT",
  http: "PROXY",
  https: "HTTPS",
  socks: "SOCKS5",
  socks4: "SOCKS4",
});

// Set while an automatic-proxy probe owns the PAC script (Chromium only).
let chromiumProbeController: AbortController | null = null;

export function updateProxySettings(requestFilter?: ProxyRequestType[]) {
  const { optimizedProxiesEnabled, passportLevel } = store.state;

  // Twitch playback wins over a running probe; the probe sees the abort and
  // discards its result.
  if (chromiumProbeController) {
    console.log(
      "⚙️ Cancelling automatic proxy probe: Twitch tab needs the proxy"
    );
    chromiumProbeController.abort();
    chromiumProbeController = null;
  }

  const proxies = getActiveProxies();
  const proxyInfoString = getProxyInfoStringFromUrls(proxies);

  const getRequestParams = (requestType: ProxyRequestType) => ({
    isChromium: true,
    optimizedProxiesEnabled: optimizedProxiesEnabled,
    passportLevel: passportLevel,
    customPassport: store.state.customPassportEnabled
      ? store.state.customPassport
      : null,
    fullModeEnabled:
      !optimizedProxiesEnabled ||
      (requestFilter != null && requestFilter.includes(requestType)),
  });
  const proxyPassportRequests = isRequestTypeProxied(
    ProxyRequestType.Passport,
    getRequestParams(ProxyRequestType.Passport)
  );
  const proxyUsherRequests = isRequestTypeProxied(
    ProxyRequestType.Usher,
    getRequestParams(ProxyRequestType.Usher)
  );
  const proxyVideoWeaverRequests = isRequestTypeProxied(
    ProxyRequestType.VideoWeaver,
    getRequestParams(ProxyRequestType.VideoWeaver)
  );
  const proxyGraphQLRequests = isRequestTypeProxied(
    ProxyRequestType.GraphQL,
    getRequestParams(ProxyRequestType.GraphQL)
  );
  const proxyTwitchWebpageRequests = isRequestTypeProxied(
    ProxyRequestType.TwitchWebpage,
    getRequestParams(ProxyRequestType.TwitchWebpage)
  );

  const config: chrome.proxy.ProxyConfig = {
    mode: "pac_script",
    pacScript: {
      data: `
        function FindProxyForURL(url, host) {
          // Passport requests.
          if (${proxyPassportRequests} && ${passportHostRegex}.test(host)) {
            return "${proxyInfoString}";
          }
          // Usher requests.
          if (${proxyUsherRequests} && ${usherHostRegex}.test(host)) {
            return "${proxyInfoString}";
          }
          // Video Weaver requests.
          if (${proxyVideoWeaverRequests} && ${videoWeaverHostRegex}.test(host)) {
            return "${proxyInfoString}";
          }
          // GraphQL requests.
          if (${proxyGraphQLRequests} && ${twitchGqlHostRegex}.test(host)) {
            return "${proxyInfoString}";
          }
          // Twitch webpage requests.
          if (${proxyTwitchWebpageRequests} && ${twitchTvHostRegex}.test(host)) {
            return "${proxyInfoString}";
          }
          return "DIRECT";
        }
      `,
    },
  };

  chrome.proxy.settings.set({ value: config, scope: "regular" }, function () {
    console.log(
      `⚙️ Proxying requests through one of: ${proxies.toString() || "<empty>"}`
    );
  });
  // Keep below code out of the callback to ensure state is updated immediately.
  // Otherwise, some requests (e.g. GQLToken) might not get proxied
  // (full mode activation not calling `updateProxySettings`).
  store.state.chromiumProxyActive = true;
  updateDnsResponses();
}

function getProxyInfoStringFromUrls(urls: string[]): string {
  return [
    ...urls.map(url => {
      const proxyInfo = getProxyInfoFromUrl(url);
      return `${PROXY_TYPE_MAP[proxyInfo.type]} ${getUrlFromProxyInfo({
        ...proxyInfo,
        // Don't include username/password in PAC script.
        username: undefined,
        password: undefined,
      })}`;
    }),
    "DIRECT",
  ].join("; ");
}

export function clearProxySettings() {
  // A running probe owns the PAC script and clears it when done.
  if (!chromiumProbeController) {
    chrome.proxy.settings.clear({ scope: "regular" }, function () {
      console.log("⚙️ Proxy settings cleared");
    });
  }
  store.state.chromiumProxyActive = false;

  if (
    Date.now() - store.state.lastStoreCleanupTimestamp >
    1000 * 60 * 60 * 24 * 7 // 7 days
  ) {
    onStartupStoreCleanup();
  }
}

/**
 * Chromium only: routes Twitch's GQL, Usher and Video Weaver hosts through
 * `proxyUrl` alone (no DIRECT fallback, so a dead proxy fails instead of
 * looking alive) while `probe` runs, then restores the previous state.
 *
 * Only runs while no Twitch tab needs the proxy. `updateProxySettings`
 * aborts the signal passed to `probe` if one opens meanwhile.
 */
export async function runWithChromiumProbePac<T>(
  proxyUrl: string,
  probe: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  if (store.state.chromiumProxyActive) {
    throw new Error("Twitch tab open; probing postponed");
  }
  if (chromiumProbeController) {
    throw new Error("Another probe is running");
  }

  const controller = new AbortController();
  chromiumProbeController = controller;
  const proxyInfoString = getProxyInfoStringFromUrls([proxyUrl])
    .split("; ")
    .filter(part => part !== "DIRECT")
    .join("; ");
  const config: chrome.proxy.ProxyConfig = {
    mode: "pac_script",
    pacScript: {
      data: `
        function FindProxyForURL(url, host) {
          if (${twitchGqlHostRegex}.test(host) || ${usherHostRegex}.test(host) || ${videoWeaverHostRegex}.test(host)) {
            return "${proxyInfoString}";
          }
          return "DIRECT";
        }
      `,
    },
  };

  try {
    await new Promise<void>(resolve =>
      chrome.proxy.settings.set({ value: config, scope: "regular" }, resolve)
    );
    return await probe(controller.signal);
  } finally {
    if (chromiumProbeController === controller) {
      chromiumProbeController = null;
      if (!store.state.chromiumProxyActive) {
        await new Promise<void>(resolve =>
          chrome.proxy.settings.clear({ scope: "regular" }, resolve)
        );
      }
    }
  }
}
