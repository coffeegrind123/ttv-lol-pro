import Bowser from "bowser";
import browser, { Storage } from "webextension-polyfill";
import $ from "../common/ts/$";
import { resolveAdIdentity } from "../common/ts/adLog";
import { alpha2 } from "../common/ts/countryCodes";
import findChannelFromTwitchTvUrl from "../common/ts/findChannelFromTwitchTvUrl";
import getActiveProxies from "../common/ts/getActiveProxies";
import getHostFromUrl from "../common/ts/getHostFromUrl";
import {
  anonymizeIpAddress,
  anonymizeIpAddresses,
} from "../common/ts/ipAddress";
import isChannelWhitelisted from "../common/ts/isChannelWhitelisted";
import isChromium from "../common/ts/isChromium";
import { getProxyInfoFromUrl } from "../common/ts/proxyInfo";
import store from "../store";
import type { State } from "../store/types";
import type { AdLogEntry, StreamStatus } from "../types";

//#region HTML Elements
const warningBannerElement = $("#warning-banner") as HTMLDivElement;
const autoProxiesSummaryElement = $(
  "#auto-proxies-summary"
) as HTMLParagraphElement;
const streamStatusElement = $("#stream-status") as HTMLDivElement;
const proxiedElement = $("#proxied") as HTMLDivElement;
const channelNameElement = $("#channel-name") as HTMLHeadingElement;
const reasonElement = $("#reason") as HTMLParagraphElement;
const infoContainerElement = $("#info-container") as HTMLDivElement;
const whitelistStatusElement = $("#whitelist-status") as HTMLDivElement;
const whitelistToggleElement = $("#whitelist-toggle") as HTMLInputElement;
const copyProxyCredentialsButtonElement = $(
  "#copy-proxy-credentials-button"
) as HTMLButtonElement;
const copyDebugInfoButtonElement = $(
  "#copy-debug-info-button"
) as HTMLButtonElement;
//#endregion

let previousStreamStatus: StreamStatus | null = null;

if (store.readyState === "complete") main();
else store.addEventListener("load", main);

async function main() {
  if (getActiveProxies().length === 0) {
    setWarningBanner("noProxies");
  }
  setAutoProxiesSummary();
  store.addEventListener(
    "change",
    (changes: Record<string, Storage.StorageChange>) => {
      if ("autoProxies" in changes || "autoProxyStatus" in changes) {
        setAutoProxiesSummary();
      }
    }
  );
  const proxies = store.state.optimizedProxiesEnabled
    ? store.state.optimizedProxies
    : store.state.normalProxies;
  const proxyInfoArray = proxies.map(getProxyInfoFromUrl);
  const shouldShowCopyCredentialsButton =
    isChromium &&
    proxyInfoArray.some(proxy => proxy.username || proxy.password);
  if (shouldShowCopyCredentialsButton) {
    copyProxyCredentialsButtonElement.parentElement!.style.display =
      "list-item";
  } else {
    copyProxyCredentialsButtonElement.parentElement!.remove();
  }

  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab || !activeTab.url) return;

  const channelName = findChannelFromTwitchTvUrl(activeTab.url);
  if (!channelName) return;

  setStreamStatusElement(channelName);
  store.addEventListener(
    "change",
    (changes: Record<string, Storage.StorageChange>) => {
      const changedKeys = Object.keys(changes) as (keyof State)[];
      const relevantKeys: (keyof State)[] = [
        "autoProxies",
        "normalProxies",
        "optimizedProxies",
        "optimizedProxiesEnabled",
        "streamStatuses",
        "whitelistedChannels",
      ];
      if (!changedKeys.some(key => relevantKeys.includes(key))) return;
      setStreamStatusElement(channelName);
    }
  );
}

function setAutoProxiesSummary() {
  const { autoProxies, autoProxiesEnabled, autoProxyStatus } = store.state;
  if (!autoProxiesEnabled) {
    autoProxiesSummaryElement.hidden = true;
    return;
  }
  const busy =
    autoProxyStatus.state === "fetching" || autoProxyStatus.state === "probing";
  const countries = [...new Set(autoProxies.map(entry => entry.twitchCountry))];
  let text =
    autoProxies.length > 0
      ? `Automatic proxies: ${autoProxies.length} working (${countries.join(", ")})`
      : "Automatic proxies: none working yet";
  if (busy) text += " · testing…";
  else if (autoProxyStatus.state === "error")
    text += ` · ${autoProxyStatus.message}`;
  autoProxiesSummaryElement.textContent = text;
  autoProxiesSummaryElement.hidden = false;
}

function setWarningBanner(type: "noProxies") {
  // Clear existing content.
  warningBannerElement.innerHTML = "";
  warningBannerElement.style.display = "none";

  switch (type) {
    case "noProxies":
      warningBannerElement.innerHTML = /*html*/ `
        <h3 class="warning-banner-title">Twitch ads are not being blocked!</h3>
        No proxies have been added to the extension. Add proxies in the
        <a href="../options/page.html" target="_blank" class="warning-banner-link">options page</a>.
      `;
      warningBannerElement.style.display = "block";
      break;
  }
}

function setStreamStatusElement(channelName: string) {
  const channelNameLower = channelName.toLowerCase();
  const isWhitelisted = isChannelWhitelisted(channelNameLower);
  const status = store.state.streamStatuses[channelNameLower];
  if (status) {
    setProxyStatus(channelNameLower, isWhitelisted, status);
    setWhitelistStatus(channelNameLower, isWhitelisted);
    streamStatusElement.style.display = "flex";
  } else {
    streamStatusElement.style.display = "none";
  }
  previousStreamStatus = status;
}

function setProxyStatus(
  channelNameLower: string,
  isWhitelisted: boolean,
  status: StreamStatus
) {
  // Proxied
  if (status.proxied) {
    proxiedElement.classList.remove("error");
    proxiedElement.classList.remove("idle");
    proxiedElement.classList.add("success");
    proxiedElement.title = "Proxied last request";
  } else if (
    !status.proxied &&
    status.proxyHost &&
    !status.reason &&
    status.stats &&
    status.stats.proxied > 0 &&
    store.state.optimizedProxiesEnabled &&
    getActiveProxies().length > 0 &&
    !isWhitelisted
  ) {
    proxiedElement.classList.remove("error");
    proxiedElement.classList.remove("success");
    proxiedElement.classList.add("idle");
    proxiedElement.title = "Proxying ad requests only";
  } else {
    proxiedElement.classList.remove("success");
    proxiedElement.classList.remove("idle");
    proxiedElement.classList.add("error");
    proxiedElement.title = "Not proxying";
  }
  if (
    previousStreamStatus &&
    !compareStreamStatuses(previousStreamStatus, status)
  ) {
    if (!proxiedElement.classList.contains("pulsing")) {
      proxiedElement.classList.add("pulsing");
    }
  }
  // Channel name
  channelNameElement.textContent = channelNameLower;
  // Reason
  if (status.reason) {
    reasonElement.textContent = status.reason;
    reasonElement.style.display = "";
  } else if (status.stats) {
    reasonElement.textContent = getProxyStatusStatsMessage(status.stats);
    reasonElement.style.display = "";
  } else {
    reasonElement.style.display = "none";
  }
  // Info
  const messages = getProxyStatusMessages(status);
  infoContainerElement.innerHTML = "";
  infoContainerElement.style.display = messages.length > 0 ? "flex" : "none";
  for (const message of messages) {
    const smallElement = document.createElement("small");
    smallElement.className = "info";
    smallElement.textContent = message;
    infoContainerElement.appendChild(smallElement);
  }
}

/**
 * Compare two stream statuses for equality.
 * @param statusA
 * @param statusB
 * @returns True if the statuses are equal, false otherwise.
 */
function compareStreamStatuses(
  statusA: StreamStatus,
  statusB: StreamStatus
): boolean {
  if (statusA.proxied !== statusB.proxied) return false;
  if (statusA.proxyHost !== statusB.proxyHost) return false;
  if (statusA.proxyCountry !== statusB.proxyCountry) return false;
  if (statusA.reason !== statusB.reason) return false;
  if ((statusA.stats == null) !== (statusB.stats == null)) return false;
  if (statusA.stats && statusB.stats) {
    if (statusA.stats.proxied !== statusB.stats.proxied) return false;
    if (statusA.stats.notProxied !== statusB.stats.notProxied) return false;
  }
  return true;
}

function getProxyStatusStatsMessage(
  stats: NonNullable<StreamStatus["stats"]>
): string {
  const formatter = new Intl.NumberFormat("en-US");
  return `Proxied: ${formatter.format(
    stats.proxied
  )} | Not proxied: ${formatter.format(stats.notProxied)}`;
}

function getProxyStatusMessages(status: StreamStatus): string[] {
  const messages = [];
  if (status.reason && status.stats) {
    messages.push(getProxyStatusStatsMessage(status.stats));
  }
  if (status.proxyHost) {
    messages.push(
      `Proxy: ${anonymizeIpAddress(status.proxyHost)}${
        store.state.optimizedProxiesEnabled ? " (optimized)" : ""
      }`
    );
  }
  if (status.proxyCountry) {
    messages.push(
      `Country: ${
        (alpha2 as Record<string, string>)[status.proxyCountry] ??
        status.proxyCountry
      }`
    );
  }
  return messages;
}

function setWhitelistStatus(channelNameLower: string, isWhitelisted: boolean) {
  whitelistStatusElement.setAttribute("data-channel", channelNameLower);
  whitelistStatusElement.setAttribute("data-whitelisted", `${isWhitelisted}`);
  whitelistToggleElement.checked = isWhitelisted;
}

proxiedElement.addEventListener("animationend", () => {
  proxiedElement.classList.remove("pulsing");
});

whitelistToggleElement.addEventListener("change", () => {
  const channelNameLower = whitelistStatusElement.getAttribute("data-channel");
  if (!channelNameLower) return alert("Channel name not found.");
  const isWhitelisted = whitelistToggleElement.checked;
  if (isWhitelisted) {
    // Add channel name to whitelist.
    store.state.whitelistedChannels.push(channelNameLower);
  } else {
    // Remove channel name from whitelist.
    store.state.whitelistedChannels = store.state.whitelistedChannels.filter(
      id => id !== channelNameLower
    );
  }
  whitelistStatusElement.setAttribute("data-whitelisted", `${isWhitelisted}`);
  browser.tabs.reload();
});

copyProxyCredentialsButtonElement.addEventListener("click", async e => {
  const copyProxyCredentialsButtonDescriptionElement =
    copyProxyCredentialsButtonElement.querySelector(
      ".list-item-description"
    ) as HTMLParagraphElement;
  copyProxyCredentialsButtonDescriptionElement.textContent =
    "Copying proxy credentials...";

  try {
    const proxies = store.state.optimizedProxiesEnabled
      ? store.state.optimizedProxies
      : store.state.normalProxies;
    const proxyInfoArray = proxies.map(getProxyInfoFromUrl);
    const firstProxyWithCredentials = proxyInfoArray.find(
      proxy => proxy.username || proxy.password
    );
    if (!firstProxyWithCredentials) {
      copyProxyCredentialsButtonDescriptionElement.textContent =
        "No proxy credentials to copy.";
      return;
    }
    const getCredentials = (): string | null => {
      if (e.shiftKey) {
        if (firstProxyWithCredentials.password) {
          return firstProxyWithCredentials.password;
        }
        return null;
      }
      if (
        firstProxyWithCredentials.username &&
        firstProxyWithCredentials.password
      ) {
        return `${firstProxyWithCredentials.username}:${firstProxyWithCredentials.password}`;
      } else if (firstProxyWithCredentials.username) {
        return firstProxyWithCredentials.username;
      } else if (firstProxyWithCredentials.password) {
        return firstProxyWithCredentials.password;
      }
      return null;
    };
    const credentials = getCredentials();
    if (!credentials) {
      copyProxyCredentialsButtonDescriptionElement.textContent =
        "No proxy credentials to copy.";
      return;
    }
    await navigator.clipboard.writeText(credentials);
    copyProxyCredentialsButtonDescriptionElement.textContent =
      "Copied to clipboard!";
  } catch (error) {
    copyProxyCredentialsButtonDescriptionElement.textContent = `Failed to copy: ${error}`;
  }
});

copyDebugInfoButtonElement.addEventListener("click", async e => {
  const copyDebugInfoButtonDescriptionElement =
    copyDebugInfoButtonElement.querySelector(
      ".list-item-description"
    ) as HTMLParagraphElement;
  copyDebugInfoButtonDescriptionElement.textContent =
    "Generating debug info...";

  try {
    const extensionInfo = await browser.management.getSelf();
    const userAgentParser = Bowser.getParser(window.navigator.userAgent);
    const tabs = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    const activeTab = tabs[0];
    const channelName =
      activeTab?.url != null ? findChannelFromTwitchTvUrl(activeTab.url) : null;
    const channelNameLower =
      channelName != null ? channelName.toLowerCase() : null;
    const isWhitelisted =
      channelNameLower != null ? isChannelWhitelisted(channelNameLower) : null;
    const status =
      channelNameLower != null
        ? store.state.streamStatuses[channelNameLower]
        : null;
    const proxySettings = await browser.proxy.settings.get({});
    const latestAdLogEntry = await getLatestAdLogEntry(channelName, !e.ctrlKey);

    const debugInfo = [
      `**Debug Info**\n`,
      `Extension: ${extensionInfo.name} ${extensionInfo.version}${
        process.env.BETA ? " Beta " + process.env.BETA : ""
      } (${extensionInfo.installType})\n`,
      `Browser: ${userAgentParser.getBrowserName()} ${userAgentParser.getBrowserVersion()} (${userAgentParser.getOSName()} ${userAgentParser.getOSVersion()})\n`,
      `Options:\n`,
      `- User experience: ${store.state.userExperienceMode}\n`,
      store.state.customPassportEnabled
        ? `- Custom passport: ${JSON.stringify(store.state.customPassport)}\n`
        : `- Passport level: ${store.state.passportLevel}\n`,
      `- Anonymous mode: ${store.state.anonymousMode}\n`,
      `- Backup streams: ${store.state.backupStreamsEnabled} (360p: ${store.state.backupStreamsAllowLowQuality}), display ads declined: ${store.state.declineDisplayAds}\n`,
      store.state.autoProxiesEnabled
        ? `- Automatic proxies: ${JSON.stringify(
            store.state.autoProxies.map(entry => ({
              url: e.shiftKey
                ? entry.url
                : anonymizeIpAddresses([entry.url])[0],
              twitchCountry: entry.twitchCountry,
              strikes: entry.strikes,
            }))
          )} (${store.state.autoProxyStatus.state}: ${store.state.autoProxyStatus.message})\n`
        : `- Automatic proxies: off\n`,
      store.state.optimizedProxiesEnabled
        ? `- Using optimized proxies: ${JSON.stringify(
            e.shiftKey
              ? store.state.optimizedProxies
              : anonymizeIpAddresses(store.state.optimizedProxies)
          )}\n`
        : `- Using normal proxies: ${JSON.stringify(
            e.shiftKey
              ? store.state.normalProxies
              : anonymizeIpAddresses(store.state.normalProxies)
          )}\n`,
      channelName != null
        ? [
            `Channel name: ${channelName}${
              isWhitelisted ? " (whitelisted)" : ""
            }\n`,
            `Stream status:\n`,
            status != null
              ? [
                  `- Reason: ${status.reason ?? "N/A"}\n`,
                  `- Proxied: ${status.stats?.proxied ?? "N/A"}, Not proxied: ${
                    status.stats?.notProxied ?? "N/A"
                  }\n`,
                  `- Proxy: ${
                    status.proxyHost != null
                      ? anonymizeIpAddress(status.proxyHost)
                      : "N/A"
                  }\n`,
                  `- Country: ${
                    status.proxyCountry
                      ? ((alpha2 as Record<string, string>)[
                          status.proxyCountry
                        ] ?? status.proxyCountry)
                      : "N/A"
                  }\n`,
                ].join("")
              : "",
            `Proxy level of control: ${proxySettings.levelOfControl}\n`,
          ].join("")
        : "",
      latestAdLogEntry
        ? [
            `Latest ad log entry (${new Date(
              latestAdLogEntry.timestamp
            ).toISOString()}):\n`,
            `- Channel name: ${latestAdLogEntry.channelName}\n`,
            `- Video Weaver host: ${getHostFromUrl(
              latestAdLogEntry.videoWeaverUrl
            )}\n`,
            `- Ad attributes: ${
              latestAdLogEntry.parsedLine
                ? JSON.stringify({
                    ...latestAdLogEntry.parsedLine,
                    adUrl: undefined,
                    adClickTrackingUrl: undefined,
                  })
                : "N/A"
            }\n`,
            `- Ad identity: ${
              latestAdLogEntry.adIdentity
                ? JSON.stringify(latestAdLogEntry.adIdentity)
                : "N/A"
            }\n`,
          ].join("")
        : "",
    ].join("");

    await navigator.clipboard.writeText(debugInfo);
    copyDebugInfoButtonDescriptionElement.textContent = "Copied to clipboard!";
  } catch (error) {
    copyDebugInfoButtonDescriptionElement.textContent = `Failed to copy: ${error}`;
  }
});

/**
 * Get the latest ad log entry for a channel, optionally resolving its ad identity.
 * @param channelNameLower
 * @param shouldResolveAdIdentity
 * @returns The latest ad log entry, or null if none found.
 */
async function getLatestAdLogEntry(
  channelNameLower: string | null,
  shouldResolveAdIdentity: boolean
): Promise<AdLogEntry | null> {
  if (store.state.adLog.length === 0) return null;
  let entryIndex = store.state.adLog.length - 1;
  if (channelNameLower) {
    for (let i = entryIndex; i >= 0; i--) {
      if (
        store.state.adLog[i].channelName?.toLowerCase() === channelNameLower
      ) {
        entryIndex = i;
        break;
      }
    }
  }
  if (shouldResolveAdIdentity) await resolveAdIdentity(entryIndex, 3000);
  return store.state.adLog[entryIndex];
}
