import Bowser from "bowser";
import browser from "webextension-polyfill";
import onStartupStoreCleanup from "../background/handlers/onStartupStoreCleanup";
import $ from "../common/ts/$";
import $$ from "../common/ts/$$";
import { sendAdLog } from "../common/ts/adLog";
import {
  AD_FREE_COUNTRIES,
  MAX_AUTO_PROXY_POOL_SIZE,
  MIN_AUTO_PROXY_POOL_SIZE,
  PARTIALLY_AD_FREE_COUNTRIES,
  QUALITY_LIMITED_COUNTRIES,
  getDefaultAutoProxyCountries,
} from "../common/ts/autoProxy/constants";
import { alpha2 } from "../common/ts/countryCodes";
import { readFile, saveFile } from "../common/ts/file";
import findChannelFromTwitchTvUrl from "../common/ts/findChannelFromTwitchTvUrl";
import isChannelWhitelisted from "../common/ts/isChannelWhitelisted";
import isChromium from "../common/ts/isChromium";
import isRequestTypeProxied from "../common/ts/isRequestTypeProxied";
import { getProxyInfoFromUrl } from "../common/ts/proxyInfo";
import {
  clearProxySettings,
  updateProxySettings,
} from "../common/ts/proxySettings";
import setUserExperienceMode from "../common/ts/setUserExperienceMode";
import store from "../store";
import getDefaultState from "../store/getDefaultState";
import type { State } from "../store/types";
import {
  AutoProxyRefreshReason,
  KeyOfType,
  MessageType,
  PassportConfig,
  ProxyRequestType,
  UserExperienceMode,
} from "../types";

//#region Types
type AllowedResult = [boolean, string?];
type InsertMode = "append" | "prepend" | "both";
type StoreStringArrayKey = KeyOfType<typeof store.state, string[]>;
type ListOptions = {
  getAlreadyExistsAlertMessage(text: string): string;
  getItemPlaceholder(text: string): string;
  getPromptPlaceholder(insertMode: InsertMode): string;
  isAddAllowed(text: string): AllowedResult;
  isEditAllowed(text: string): AllowedResult;
  onChange?(oldText: string | undefined, newText: string): void;
  focusPrompt: boolean;
  hidePromptMarker: boolean;
  insertMode: InsertMode;
  spellcheck: boolean;
};
//#endregion

//#region HTML Elements
// Import/Export
const exportButtonElement = $("#export-button") as HTMLButtonElement;
const importButtonElement = $("#import-button") as HTMLButtonElement;
const resetButtonElement = $("#reset-button") as HTMLButtonElement;
// Experience
const experienceInputElements = $$(
  "input[type='radio'][name='experience']"
) as NodeListOf<HTMLInputElement>;
const expertModeSegmentElement = $("#expert-mode-segment") as HTMLDivElement;
// Passport
const passportLevelSliderElement = $(
  "#passport-level-slider"
) as HTMLInputElement;
const passportLevelWarningElement = $("#passport-level-warning") as HTMLElement;
const customPassportCheckboxElements = $$(
  "input[type='checkbox'][name='passport-custom']"
) as NodeListOf<HTMLInputElement>;
const customPassportGraphQLTokenElement = $(
  "#passport-custom-graphQLToken"
) as HTMLInputElement;
const customPassportGraphQLIntegrityElement = $(
  "#passport-custom-graphQLIntegrity"
) as HTMLInputElement;
const customPassportGraphQLAllElement = $(
  "#passport-custom-graphQLAll"
) as HTMLInputElement;
const anonymousModeCheckboxElement = $(
  "#anonymous-mode-checkbox"
) as HTMLInputElement;
// Proxy usage
const passportLevelProxyUsageElement = $(
  "#passport-level-proxy-usage"
) as HTMLDetailsElement;
const passportLevelProxyUsageSummaryElement = $(
  "#passport-level-proxy-usage-summary"
) as HTMLElement;
const passportLevelProxyUsagePassportElement = $(
  "#passport-level-proxy-usage-passport"
) as HTMLTableCellElement;
const passportLevelProxyUsageUsherElement = $(
  "#passport-level-proxy-usage-usher"
) as HTMLTableCellElement;
const passportLevelProxyUsageVideoWeaverElement = $(
  "#passport-level-proxy-usage-video-weaver"
) as HTMLTableCellElement;
const passportLevelProxyUsageGqlElement = $(
  "#passport-level-proxy-usage-gql"
) as HTMLTableCellElement;
const passportLevelProxyUsageWwwElement = $(
  "#passport-level-proxy-usage-www"
) as HTMLTableCellElement;
// Whitelisted channels
const whitelistedChannelsListElement = $(
  "#whitelisted-channels-list"
) as HTMLUListElement;
const whitelistSubscriptionsCheckboxElement = $(
  "#whitelist-subscriptions-checkbox"
) as HTMLInputElement;
// Backup streams
const backupStreamsEnabledCheckboxElement = $(
  "#backup-streams-enabled-checkbox"
) as HTMLInputElement;
const backupStreamsLowQualityCheckboxElement = $(
  "#backup-streams-low-quality-checkbox"
) as HTMLInputElement;
const declineDisplayAdsCheckboxElement = $(
  "#decline-display-ads-checkbox"
) as HTMLInputElement;
// Automatic proxies
const autoProxiesFailuresTableBodyElement = $(
  "#auto-proxies-failures-table-body"
) as HTMLTableSectionElement;
const autoProxiesEnabledCheckboxElement = $(
  "#auto-proxies-enabled-checkbox"
) as HTMLInputElement;
const autoProxiesStatusElement = $("#auto-proxies-status") as HTMLDivElement;
const autoProxiesStatusTextElement = $(
  "#auto-proxies-status-text"
) as HTMLSpanElement;
const autoProxiesRefreshButtonElement = $(
  "#auto-proxies-refresh-button"
) as HTMLButtonElement;
const autoProxiesTableElement = $("#auto-proxies-table") as HTMLTableElement;
const autoProxiesTableBodyElement = $(
  "#auto-proxies-table-body"
) as HTMLTableSectionElement;
const autoProxiesCountriesAdFreeElement = $(
  "#auto-proxies-countries-ad-free"
) as HTMLDivElement;
const autoProxiesCountriesPartialElement = $(
  "#auto-proxies-countries-partial"
) as HTMLDivElement;
const autoProxiesCountriesResetButtonElement = $(
  "#auto-proxies-countries-reset-button"
) as HTMLButtonElement;
const autoProxiesPoolSizeInputElement = $(
  "#auto-proxies-pool-size-input"
) as HTMLInputElement;
const autoProxiesSourcesListElement = $(
  "#auto-proxies-sources-list"
) as HTMLOListElement;
// Proxies
const optimizedProxiesInputElement = $("#optimized") as HTMLInputElement;
const optimizedProxiesListElement = $(
  "#optimized-proxies-list"
) as HTMLOListElement;
const normalProxiesInputElement = $("#normal") as HTMLInputElement;
const normalProxiesListElement = $("#normal-proxies-list") as HTMLOListElement;
const otherProtocolsCheckboxElement = $(
  "#other-protocols-checkbox"
) as HTMLInputElement;
// Ad log
const adLogEnabledCheckboxElement = $(
  "#ad-log-enabled-checkbox"
) as HTMLInputElement;
const adLogSendButtonElement = $("#ad-log-send-button") as HTMLButtonElement;
const adLogExportButtonElement = $(
  "#ad-log-export-button"
) as HTMLButtonElement;
const adLogClearButtonElement = $("#ad-log-clear-button") as HTMLButtonElement;
// Troubleshooting
const viewStatusOfProxiesButtonElement = $(
  "#view-status-of-proxies-button"
) as HTMLButtonElement;
const clearSessionStorageButtonElement = $(
  "#clear-session-storage-button"
) as HTMLButtonElement;
const unsetPacScriptButtonElement = $(
  "#unset-pac-script-button"
) as HTMLButtonElement;
const generateTwitchTabsReportButtonElement = $(
  "#generate-twitch-tabs-report-button"
) as HTMLButtonElement;
// Footer
const versionElement = $("#version") as HTMLParagraphElement;
// Main
const mainElement = $("main") as HTMLElement;
//#endregion

const DEFAULT_STATE: Readonly<State> = Object.freeze(getDefaultState());
const DEFAULT_LIST_OPTIONS: Readonly<ListOptions> = Object.freeze({
  getAlreadyExistsAlertMessage: text => `'${text}' is already in the list`,
  getItemPlaceholder: text => `Leave empty to remove '${text}' from the list`,
  getPromptPlaceholder: () => "Enter text to create a new item…",
  isAddAllowed: () => [true] as AllowedResult,
  isEditAllowed: () => [true] as AllowedResult,
  focusPrompt: false, // Is set to `true` after the user has added an item.
  hidePromptMarker: false,
  insertMode: "append",
  spellcheck: false,
});

if (store.readyState === "complete") main();
else store.addEventListener("load", main);

function main() {
  // Remove elements that are only for Chromium or Firefox.
  document
    .querySelectorAll(isChromium ? ".firefox-only" : ".chromium-only")
    .forEach(element => element.remove());
  // Experience
  if (store.state.userExperienceMode === "expertMode") {
    expertModeSegmentElement.removeAttribute("hidden");
  }
  experienceInputElements.forEach(inputElement => {
    inputElement.addEventListener("change", () => {
      setUserExperienceMode(inputElement.value as UserExperienceMode);
      updateUI();
    });
  });
  // Passport
  passportLevelSliderElement.addEventListener("input", () => {
    store.state.passportLevel = parseInt(passportLevelSliderElement.value);
    if (isChromium && store.state.chromiumProxyActive) {
      updateProxySettings();
    }
    updatePassportUI();
  });
  customPassportCheckboxElements.forEach(checkbox => {
    checkbox.addEventListener("change", () => {
      store.state.customPassport[checkbox.value as keyof PassportConfig] =
        checkbox.checked;
      if (isChromium && store.state.chromiumProxyActive) {
        updateProxySettings();
      }
      updatePassportUI();
    });
  });
  anonymousModeCheckboxElement.addEventListener("change", () => {
    store.state.anonymousMode = anonymousModeCheckboxElement.checked;
  });
  // Whitelisted channels
  whitelistSubscriptionsCheckboxElement.addEventListener("change", () => {
    const { checked } = whitelistSubscriptionsCheckboxElement;
    store.state.whitelistChannelSubscriptions = checked;
    if (!checked) {
      // Clear active channel subscriptions to free up storage space.
      store.state.activeChannelSubscriptions = [];
    }
  });
  // Backup streams
  backupStreamsEnabledCheckboxElement.addEventListener("change", () => {
    store.state.backupStreamsEnabled =
      backupStreamsEnabledCheckboxElement.checked;
    backupStreamsLowQualityCheckboxElement.disabled =
      !store.state.backupStreamsEnabled;
  });
  backupStreamsLowQualityCheckboxElement.addEventListener("change", () => {
    store.state.backupStreamsAllowLowQuality =
      backupStreamsLowQualityCheckboxElement.checked;
  });
  declineDisplayAdsCheckboxElement.addEventListener("change", () => {
    store.state.declineDisplayAds = declineDisplayAdsCheckboxElement.checked;
  });
  // Automatic proxies
  autoProxiesEnabledCheckboxElement.addEventListener("change", () => {
    store.state.autoProxiesEnabled = autoProxiesEnabledCheckboxElement.checked;
    if (isChromium && store.state.chromiumProxyActive) {
      updateProxySettings();
    }
    if (store.state.autoProxiesEnabled) requestAutoProxyRefresh("settings");
    updateAutoProxiesUI();
  });
  autoProxiesRefreshButtonElement.addEventListener("click", () =>
    requestAutoProxyRefresh("manual")
  );
  autoProxiesCountriesResetButtonElement.addEventListener("click", () => {
    setAutoProxyCountries(getDefaultAutoProxyCountries());
  });
  autoProxiesPoolSizeInputElement.addEventListener("change", () => {
    const value = Math.round(Number(autoProxiesPoolSizeInputElement.value));
    if (!Number.isFinite(value)) return updateAutoProxiesUI();
    store.state.autoProxyPoolSize = Math.min(
      MAX_AUTO_PROXY_POOL_SIZE,
      Math.max(MIN_AUTO_PROXY_POOL_SIZE, value)
    );
    if (store.state.autoProxies.length > store.state.autoProxyPoolSize) {
      store.state.autoProxies = store.state.autoProxies.slice(
        0,
        store.state.autoProxyPoolSize
      );
      if (isChromium && store.state.chromiumProxyActive) {
        updateProxySettings();
      }
    }
    requestAutoProxyRefresh("settings");
    updateAutoProxiesUI();
  });
  autoProxiesTableBodyElement.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest(
      "button[data-proxy-url]"
    ) as HTMLButtonElement | null;
    if (!button) return;
    removeAutoProxy(button.dataset.proxyUrl!);
  });
  store.addEventListener("change", (changes: Record<string, unknown>) => {
    const keys = Object.keys(changes);
    if (
      keys.some(key =>
        [
          "autoProxies",
          "autoProxyRecentFailures",
          "autoProxyStatus",
          "autoProxiesEnabled",
        ].includes(key)
      )
    ) {
      updateAutoProxiesUI();
    }
  });
  // Proxies
  const onProxyModeChange = () => {
    store.state.optimizedProxiesEnabled = optimizedProxiesInputElement.checked;
    if (isChromium && store.state.chromiumProxyActive) {
      updateProxySettings();
    }
    updatePassportUI();
  };
  optimizedProxiesInputElement.addEventListener("change", onProxyModeChange);
  normalProxiesInputElement.addEventListener("change", onProxyModeChange);
  otherProtocolsCheckboxElement.addEventListener("change", () => {
    store.state.allowOtherProxyProtocols =
      otherProtocolsCheckboxElement.checked;
  });
  // Ad log
  adLogEnabledCheckboxElement.addEventListener("change", () => {
    store.state.adLogEnabled = adLogEnabledCheckboxElement.checked;
  });
  adLogSendButtonElement.addEventListener("click", async () => {
    if (!isChromium) {
      let response: boolean;
      try {
        response = await browser.permissions.request({
          data_collection: ["websiteContent"],
        });
      } catch (error) {
        console.error(error);
        response = confirm(
          "Allow extension developer to collect website content?"
        );
      }
      if (!response) {
        alert("Log sending cancelled. Permission not granted.");
        return;
      }
    }
    const success = await sendAdLog();
    if (success === null) {
      return alert("No log entries to send.");
    }
    if (!success) {
      return alert("Failed to send log.");
    }
    alert("Log sent successfully.");
  });
  adLogExportButtonElement.addEventListener("click", () => {
    saveFile(
      "ttv-lol-pro_ad-log.json",
      JSON.stringify(store.state.adLog, null, 2),
      "application/json;charset=utf-8"
    );
  });
  adLogClearButtonElement.addEventListener("click", () => {
    const confirmation = confirm(
      "Are you sure you want to clear the ad log? This cannot be undone."
    );
    if (!confirmation) return;
    store.state.adLog = [];
  });
  // Footer
  versionElement.textContent = `Version ${
    browser.runtime.getManifest().version
  }${process.env.BETA ? " Beta " + process.env.BETA : ""}`;
  // Main
  updateUI(); // Load values from store into the UI.
  mainElement.style.display = "block";
}

/**
 * Updates the values of all options in the UI to match the values in the store.
 */
function updateUI() {
  // Experience
  experienceInputElements.forEach(inputElement => {
    if (inputElement.value === store.state.userExperienceMode) {
      inputElement.checked = true;
    }
  });
  $$(".block-ads").forEach(e => e.setAttribute("hidden", "true"));
  $$(".unlock-best-quality").forEach(e => e.setAttribute("hidden", "true"));
  $$(".expert-mode").forEach(e => e.setAttribute("hidden", "true"));
  switch (store.state.userExperienceMode) {
    case "blockAds":
      $$(".block-ads").forEach(e => e.removeAttribute("hidden"));
      break;
    case "unlockBestQuality":
      $$(".unlock-best-quality").forEach(e => e.removeAttribute("hidden"));
      break;
    case "expertMode":
      $$(".expert-mode").forEach(e => e.removeAttribute("hidden"));
      break;
  }
  // Passport
  passportLevelSliderElement.value = store.state.passportLevel.toString();
  customPassportCheckboxElements.forEach(checkbox => {
    checkbox.checked =
      store.state.customPassport[checkbox.value as keyof PassportConfig];
  });
  updatePassportUI();
  anonymousModeCheckboxElement.checked = store.state.anonymousMode;
  // Whitelisted channels
  listInit(whitelistedChannelsListElement, "whitelistedChannels", {
    getAlreadyExistsAlertMessage: channelName =>
      `'${channelName}' is already whitelisted`,
    getPromptPlaceholder: () => "Enter a channel name…",
    isAddAllowed(text) {
      if (!/^[a-z0-9_]+$/i.test(text)) {
        return [false, `'${text}' is not a valid channel name`];
      }
      return [true];
    },
  });
  whitelistSubscriptionsCheckboxElement.checked =
    store.state.whitelistChannelSubscriptions;
  // Backup streams
  backupStreamsEnabledCheckboxElement.checked =
    store.state.backupStreamsEnabled;
  backupStreamsLowQualityCheckboxElement.checked =
    store.state.backupStreamsAllowLowQuality;
  backupStreamsLowQualityCheckboxElement.disabled =
    !store.state.backupStreamsEnabled;
  declineDisplayAdsCheckboxElement.checked = store.state.declineDisplayAds;
  // Automatic proxies
  autoProxiesEnabledCheckboxElement.checked = store.state.autoProxiesEnabled;
  autoProxiesPoolSizeInputElement.value = `${store.state.autoProxyPoolSize}`;
  renderAutoProxyCountries();
  listInit(autoProxiesSourcesListElement, "autoProxySourceUrls", {
    getPromptPlaceholder: () => "Enter a proxy list URL…",
    isAddAllowed: isAutoProxySourceUrlAllowed,
    isEditAllowed: isAutoProxySourceUrlAllowed,
    onChange() {
      requestAutoProxyRefresh("settings");
    },
  });
  updateAutoProxiesUI();
  // Proxies
  if (store.state.optimizedProxiesEnabled)
    optimizedProxiesInputElement.checked = true;
  else normalProxiesInputElement.checked = true;
  loadProxiesLists();
  otherProtocolsCheckboxElement.checked = store.state.allowOtherProxyProtocols;
  // Ad log
  adLogEnabledCheckboxElement.checked = store.state.adLogEnabled;
}

/**
 * Updates the proxy usage information in the passport section of the UI.
 */
function updatePassportUI() {
  let usageScore = 0;
  let showPassportLevelWarning = false;

  const paramsUnflagged = {
    isChromium: isChromium,
    optimizedProxiesEnabled: store.state.optimizedProxiesEnabled,
    passportLevel: store.state.passportLevel,
    customPassport: store.state.customPassportEnabled
      ? store.state.customPassport
      : null,
    fullModeEnabled: false,
    isFlagged: false,
  };
  const paramsFlagged = {
    ...paramsUnflagged,
    fullModeEnabled: true,
    isFlagged: true,
  };
  // Passport
  if (isRequestTypeProxied(ProxyRequestType.Passport, paramsUnflagged)) {
    passportLevelProxyUsagePassportElement.textContent = "All";
  } else {
    passportLevelProxyUsagePassportElement.textContent = "None";
  }
  // Usher
  if (isRequestTypeProxied(ProxyRequestType.Usher, paramsFlagged)) {
    passportLevelProxyUsageUsherElement.textContent = "All";
  } else {
    passportLevelProxyUsageUsherElement.textContent = "None";
  }
  // Video Weaver
  const flaggedVideoWeaverProxied = isRequestTypeProxied(
    ProxyRequestType.VideoWeaver,
    paramsFlagged
  );
  const unflaggedVideoWeaverProxied = isRequestTypeProxied(
    ProxyRequestType.VideoWeaver,
    paramsUnflagged
  );
  if (flaggedVideoWeaverProxied && unflaggedVideoWeaverProxied) {
    passportLevelProxyUsageVideoWeaverElement.textContent = "All";
    usageScore += 1;
  } else if (flaggedVideoWeaverProxied && !unflaggedVideoWeaverProxied) {
    passportLevelProxyUsageVideoWeaverElement.textContent = "Few";
  } else {
    passportLevelProxyUsageVideoWeaverElement.textContent = "None";
  }
  // GraphQL
  if (isRequestTypeProxied(ProxyRequestType.GraphQLAll, paramsUnflagged)) {
    passportLevelProxyUsageGqlElement.textContent = "All";
    usageScore += 1;
    showPassportLevelWarning = true;
  } else if (
    isRequestTypeProxied(ProxyRequestType.GraphQLIntegrity, paramsUnflagged)
  ) {
    passportLevelProxyUsageGqlElement.textContent = "Some";
    usageScore += 1;
    showPassportLevelWarning = true;
  } else if (
    isRequestTypeProxied(ProxyRequestType.GraphQLToken, paramsUnflagged)
  ) {
    passportLevelProxyUsageGqlElement.textContent = "Few";
  } else {
    passportLevelProxyUsageGqlElement.textContent = "None";
  }
  // WWW
  if (isRequestTypeProxied(ProxyRequestType.TwitchWebpage, paramsUnflagged)) {
    passportLevelProxyUsageWwwElement.textContent = "All";
  } else {
    passportLevelProxyUsageWwwElement.textContent = "None";
  }

  switch (usageScore) {
    case 0:
      passportLevelProxyUsageSummaryElement.textContent = "🙂 Low proxy usage";
      passportLevelProxyUsageElement.dataset.usage = "low";
      break;
    case 1:
      passportLevelProxyUsageSummaryElement.textContent =
        "😐 Medium proxy usage";
      passportLevelProxyUsageElement.dataset.usage = "medium";
      break;
    default:
      passportLevelProxyUsageSummaryElement.textContent = "🙁 High proxy usage";
      passportLevelProxyUsageElement.dataset.usage = "high";
      break;
  }
  passportLevelWarningElement.style.display = showPassportLevelWarning
    ? "block"
    : "none";

  // Custom passport
  customPassportGraphQLAllElement.disabled =
    store.state.optimizedProxiesEnabled;
  const disableTokenAndIntegrity =
    !customPassportGraphQLAllElement.disabled &&
    (isChromium || customPassportGraphQLAllElement.checked);
  customPassportGraphQLTokenElement.disabled = disableTokenAndIntegrity;
  customPassportGraphQLIntegrityElement.disabled = disableTokenAndIntegrity;
}

/**
 * Initializes the optimized and normal proxies lists.
 */
function loadProxiesLists() {
  listInit(optimizedProxiesListElement, "optimizedProxies", {
    getPromptPlaceholder: insertMode => {
      if (insertMode == "prepend") return "Enter a proxy URL… (Primary)";
      return "Enter a proxy URL… (Fallback)";
    },
    isAddAllowed: isOptimizedProxyUrlAllowed,
    onChange() {
      if (isChromium && store.state.chromiumProxyActive) {
        updateProxySettings();
      }
    },
    hidePromptMarker: true,
    insertMode: "both",
  });
  listInit(normalProxiesListElement, "normalProxies", {
    getPromptPlaceholder: insertMode => {
      if (insertMode == "prepend") return "Enter a proxy URL… (Primary)";
      return "Enter a proxy URL… (Fallback)";
    },
    isAddAllowed: isNormalProxyUrlAllowed,
    onChange() {
      if (isChromium && store.state.chromiumProxyActive) {
        updateProxySettings();
      }
    },
    hidePromptMarker: true,
    insertMode: "both",
  });
}

//#region Automatic proxies
function requestAutoProxyRefresh(reason: AutoProxyRefreshReason) {
  autoProxiesRefreshButtonElement.disabled = true;
  browser.runtime
    .sendMessage({ type: MessageType.AutoProxyRefresh, reason })
    .catch(error => {
      console.error(error);
      autoProxiesStatusTextElement.textContent = `Could not reach the background script: ${error}`;
    })
    .finally(() => {
      autoProxiesRefreshButtonElement.disabled = false;
      updateAutoProxiesUI();
    });
}

function isAutoProxySourceUrlAllowed(url: string): AllowedResult {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return [false, "Proxy lists must be served over HTTPS"];
    }
  } catch {
    return [false, `'${url}' is not a valid URL`];
  }
  return [true];
}

function setAutoProxyCountries(countries: string[]) {
  store.state.autoProxyCountries = countries;
  renderAutoProxyCountries();
  requestAutoProxyRefresh("settings");
}

function renderAutoProxyCountries() {
  const selected = new Set(store.state.autoProxyCountries);
  const render = (container: HTMLElement, codes: readonly string[]) => {
    container.innerHTML = "";
    for (const code of codes) {
      const id = `auto-proxies-country-${code}`;
      const label = document.createElement("label");
      label.htmlFor = id;
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = id;
      checkbox.checked = selected.has(code);
      checkbox.addEventListener("change", () => {
        const next = new Set(store.state.autoProxyCountries);
        if (checkbox.checked) next.add(code);
        else next.delete(code);
        setAutoProxyCountries([...next]);
      });
      const name = (alpha2 as Record<string, string>)[code] ?? code;
      const limit = QUALITY_LIMITED_COUNTRIES[code];
      const text = document.createElement("span");
      text.textContent = limit ? `${name} (${limit})` : name;
      label.append(checkbox, text);
      container.append(label);
    }
  };
  render(autoProxiesCountriesAdFreeElement, AD_FREE_COUNTRIES);
  render(autoProxiesCountriesPartialElement, PARTIALLY_AD_FREE_COUNTRIES);
}

function removeAutoProxy(url: string) {
  store.state.autoProxies = store.state.autoProxies.filter(
    entry => entry.url !== url
  );
  // Keep it out of the next refreshes too.
  store.state.autoProxyRejected = {
    ...store.state.autoProxyRejected,
    [url]: Date.now() + 1000 * 60 * 60 * 24,
  };
  if (isChromium && store.state.chromiumProxyActive) {
    updateProxySettings();
  }
  requestAutoProxyRefresh("settings");
}

function formatAgo(timestamp: number): string {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

function updateAutoProxiesUI() {
  const { autoProxies, autoProxiesEnabled, autoProxyStatus } = store.state;

  autoProxiesStatusElement.dataset.state = autoProxyStatus.state;
  const busy =
    autoProxyStatus.state === "fetching" || autoProxyStatus.state === "probing";
  let text: string;
  if (!autoProxiesEnabled) {
    text = "Off.";
  } else if (busy) {
    text = `${autoProxyStatus.message} (${autoProxyStatus.tested} tested, ${autoProxyStatus.accepted} working)`;
  } else if (autoProxyStatus.updatedAt) {
    text = `${autoProxyStatus.message} Last refresh ${formatAgo(autoProxyStatus.updatedAt)}.`;
  } else {
    text = "Not run yet.";
  }
  autoProxiesStatusTextElement.textContent = text;
  autoProxiesRefreshButtonElement.disabled = !autoProxiesEnabled || busy;

  autoProxiesTableBodyElement.innerHTML = "";
  autoProxiesTableElement.hidden =
    !autoProxiesEnabled || autoProxies.length === 0;
  for (const entry of autoProxies) {
    const row = document.createElement("tr");
    const countryName =
      (alpha2 as Record<string, string>)[entry.twitchCountry] ??
      entry.twitchCountry;
    const cells = [
      entry.url,
      entry.listedCountry && entry.listedCountry !== entry.twitchCountry
        ? `${countryName} (list said ${entry.listedCountry})`
        : countryName,
      `${entry.latencyMs} ms`,
      formatAgo(entry.lastCheckedAt),
      `${entry.strikes}`,
    ];
    for (const value of cells) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    const actionCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.dataset.proxyUrl = entry.url;
    actionCell.append(removeButton);
    row.append(actionCell);
    autoProxiesTableBodyElement.append(row);
  }

  const failureLabels: Record<string, string> = {
    cdn: "Blocked by Twitch's CDN",
    country: "Outside the selected countries",
    leak: "Bypassed",
    twitch: "Refused by Twitch",
    unreachable: "Unreachable",
    playlist: "Stream didn't load",
    ads: "Let ads through",
  };
  autoProxiesFailuresTableBodyElement.innerHTML = "";
  for (const failure of store.state.autoProxyRecentFailures) {
    const row = document.createElement("tr");
    for (const value of [
      formatAgo(failure.at),
      failure.url,
      failureLabels[failure.kind] ?? failure.kind,
      failure.reason,
    ]) {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.append(cell);
    }
    autoProxiesFailuresTableBodyElement.append(row);
  }
}
//#endregion

function isOptimizedProxyUrlAllowed(url: string): AllowedResult {
  const urlLower = url.toLowerCase();

  // Allow default proxies.
  if (DEFAULT_STATE.optimizedProxies.includes(urlLower)) {
    return [true];
  }

  // Forbid v1 proxies.
  const proxiesV1 = [
    // *.ttv.lol
    "api.ttv.lol",
    // *.luminous.dev
    "eu.luminous.dev",
    "eu2.luminous.dev",
    "as.luminous.dev",
    "bg.luminous.dev",
    // *.perfprod.com
    "lb-eu.perfprod.com",
    "lb-eu2.perfprod.com",
    "lb-na.perfprod.com",
    "lb-as.perfprod.com",
    // *.cdn-perfprod.com
    "lb-eu.cdn-perfprod.com",
    "lb-eu2.cdn-perfprod.com",
    "lb-na.cdn-perfprod.com",
    "lb-as.cdn-perfprod.com",
  ];
  if (proxiesV1.some(proxy => urlLower.includes(proxy))) {
    return [false, "TTV LOL PRO v1 proxies are not compatible"];
  }

  if (url.includes("://")) {
    const [protocol] = url.split("://", 1);
    if (!store.state.allowOtherProxyProtocols) {
      return [
        false,
        "Proxy URLs are not allowed to contain a protocol (e.g. 'http://')",
      ];
    } else if (!["http", "https", "socks", "socks4"].includes(protocol)) {
      return [false, `'${protocol}' is not a supported protocol`];
    }
    url = url.substring(protocol.length + 3, url.length);
  }

  if (url.includes("/")) {
    return [false, "Proxy URLs must not contain a path (e.g. '/path')"];
  }

  try {
    const host = url.substring(url.lastIndexOf("@") + 1, url.length);
    new URL(`http://${host}`); // Throws if the host is invalid.
    return [true];
  } catch {
    return [false, `'${url}' is not a valid proxy URL`];
  }
}

function isNormalProxyUrlAllowed(url: string): AllowedResult {
  const [allowed, error] = isOptimizedProxyUrlAllowed(url);
  if (!allowed) return [false, error];

  const urlLower = url.toLowerCase();

  // Allow default proxies.
  if (DEFAULT_STATE.normalProxies.includes(urlLower)) {
    return [true];
  }

  // Allow donator proxy (password protected).
  const proxyInfo = getProxyInfoFromUrl(urlLower);
  const restrictedProxyHost = "restricted.api.cdn-perfprod.com";
  if (
    proxyInfo.host === restrictedProxyHost ||
    proxyInfo.host.endsWith(`.${restrictedProxyHost}`)
  ) {
    return [true];
  }

  // Forbid other perfprod.com proxies.
  if (
    urlLower.includes(".perfprod.com") ||
    urlLower.includes(".cdn-perfprod.com")
  ) {
    return [false, "This proxy is not compatible with 'Proxy all requests'"];
  }

  // Forbid proxies containing "optimized".
  if (urlLower.includes("optimized")) {
    return [false, "This proxy is not compatible with 'Proxy all requests'"];
  }

  return [true];
}

/**
 * Initializes a list element.
 * @param listElement
 * @param storeKey
 * @param options
 */
function listInit(
  listElement: HTMLOListElement | HTMLUListElement,
  storeKey: StoreStringArrayKey,
  options: Partial<ListOptions> = {}
) {
  listElement.innerHTML = ""; // Reset list element.
  const listOptions: ListOptions = { ...DEFAULT_LIST_OPTIONS, ...options };
  const updateListUI = () => listInit(listElement, storeKey, options);
  for (const text of store.state[storeKey]) {
    _listAppend(
      listElement,
      storeKey,
      text,
      { ...listOptions, insertMode: "append" }, // Always append when initializing because the array is already in the correct order.
      updateListUI
    );
  }
  // Add prompt(s).
  if (options.insertMode === "both") {
    _listPrompt(
      listElement,
      storeKey,
      { ...listOptions, insertMode: "append" },
      updateListUI
    );
    _listPrompt(
      listElement,
      storeKey,
      { ...listOptions, insertMode: "prepend" },
      updateListUI
    );
  } else {
    _listPrompt(listElement, storeKey, listOptions, updateListUI);
  }
}

/**
 * Appends an item to a list element.
 * @param listElement
 * @param storeKey
 * @param text
 * @param options
 */
function _listAppend(
  listElement: HTMLOListElement | HTMLUListElement,
  storeKey: StoreStringArrayKey,
  text: string,
  options: ListOptions,
  updateListUI: () => void
) {
  const listItem = document.createElement("li");
  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.placeholder = options.getItemPlaceholder(text);
  textInput.spellcheck = options.spellcheck;
  textInput.value = text;
  const moveButtonsContainer = document.createElement("span");
  moveButtonsContainer.className = "move-buttons-container";
  const moveUpButton = document.createElement("button");
  moveUpButton.textContent = "↑";
  moveUpButton.title = "Move up";
  const moveDownButton = document.createElement("button");
  moveDownButton.textContent = "↓";
  moveDownButton.title = "Move down";

  const [allowed] = options.isEditAllowed(text);
  if (!allowed) textInput.disabled = true;

  // Highlight text when focused.
  textInput.addEventListener("focus", textInput.select.bind(textInput));

  // Update store when text is changed.
  textInput.addEventListener("change", e => {
    // Get index of item in array.
    const itemIndex = store.state[storeKey].findIndex(
      item => item.toLowerCase() === text.toLowerCase()
    );
    if (itemIndex === -1)
      return console.error(`Item '${text}' not found in '${storeKey}' array`);

    const oldText = text;
    const newText = textInput.value.trim();
    // Remove item if text is empty.
    if (newText === "") {
      store.state[storeKey].splice(itemIndex, 1);
      listItem.remove();
      if (options.onChange) options.onChange(oldText, newText);
      return;
    }
    // Check if text is valid.
    const [allowed, error] = options.isAddAllowed(newText);
    if (!allowed) {
      alert(error || "You cannot add this item");
      textInput.value = text;
      return;
    }
    // Update item in array.
    store.state[storeKey][itemIndex] = newText;
    textInput.placeholder = options.getItemPlaceholder(newText);
    textInput.value = newText; // Update text in case it was trimmed.
    text = newText; // Update current text variable.
    if (options.onChange) options.onChange(oldText, newText);
  });

  moveUpButton.addEventListener("click", e => {
    e.preventDefault();
    // Get index of item in array.
    const itemIndex = store.state[storeKey].findIndex(
      item => item.toLowerCase() === text.toLowerCase()
    );
    if (itemIndex === -1)
      return console.error(`Item '${text}' not found in '${storeKey}' array`);
    if (itemIndex === 0)
      return console.warn("Item is already at the top of the list");
    // Swap item with the previous one.
    const array = store.state[storeKey];
    [array[itemIndex - 1], array[itemIndex]] = [
      array[itemIndex],
      array[itemIndex - 1],
    ];
    store.state[storeKey] = array;
    // Update list UI.
    updateListUI();
  });

  moveDownButton.addEventListener("click", e => {
    e.preventDefault();
    // Get index of item in array.
    const itemIndex = store.state[storeKey].findIndex(
      item => item.toLowerCase() === text.toLowerCase()
    );
    if (itemIndex === -1)
      return console.error(`Item '${text}' not found in '${storeKey}' array`);
    if (itemIndex === store.state[storeKey].length - 1)
      return console.warn("Item is already at the bottom of the list");
    // Swap item with the next one.
    const array = store.state[storeKey];
    [array[itemIndex], array[itemIndex + 1]] = [
      array[itemIndex + 1],
      array[itemIndex],
    ];
    store.state[storeKey] = array;
    // Update list UI.
    updateListUI();
  });

  moveButtonsContainer.append(moveUpButton);
  moveButtonsContainer.append(moveDownButton);
  listItem.append(textInput);
  listItem.append(moveButtonsContainer);

  if (options.insertMode === "prepend") listElement.prepend(listItem);
  else listElement.append(listItem);
}

/**
 * Creates a prompt (text input) to add new items to a list.
 * @param listElement
 * @param storeKey
 * @param options
 */
function _listPrompt(
  listElement: HTMLOListElement | HTMLUListElement,
  storeKey: StoreStringArrayKey,
  options: ListOptions,
  updateListUI: () => void
) {
  const listItem = document.createElement("li");
  if (options.hidePromptMarker) listItem.classList.add("hide-marker");
  const promptInput = document.createElement("input");
  promptInput.type = "text";
  promptInput.placeholder = options.getPromptPlaceholder(options.insertMode);
  promptInput.spellcheck = options.spellcheck;

  // Update store when text is changed.
  promptInput.addEventListener("change", e => {
    const text = promptInput.value.trim();
    // Do nothing if text is empty.
    if (text === "") return;
    // Check if text is valid.
    const [allowed, error] = options.isAddAllowed(text);
    if (!allowed) {
      alert(error || "You cannot add this item");
      promptInput.value = "";
      return;
    }
    // Check if item already exists.
    const alreadyExists = store.state[storeKey].some(
      item => item.toLowerCase() === text.toLowerCase()
    );
    if (alreadyExists) {
      alert(options.getAlreadyExistsAlertMessage(text));
      promptInput.value = "";
      return;
    }
    // Add item to array.
    const newArray = store.state[storeKey];
    if (options.insertMode === "prepend") newArray.unshift(text);
    else newArray.push(text);
    store.state[storeKey] = newArray;
    if (options.onChange) options.onChange(undefined, text);

    listItem.remove();
    _listAppend(listElement, storeKey, text, options, updateListUI);
    _listPrompt(
      listElement,
      storeKey,
      { ...options, focusPrompt: true },
      updateListUI
    );
  });

  listItem.append(promptInput);

  if (options.insertMode === "prepend") listElement.prepend(listItem);
  else listElement.append(listItem);

  if (options.focusPrompt) promptInput.focus();
}

exportButtonElement.addEventListener("click", () => {
  const state: Partial<State> = {
    adLogEnabled: store.state.adLogEnabled,
    allowOtherProxyProtocols: store.state.allowOtherProxyProtocols,
    anonymousMode: store.state.anonymousMode,
    autoProxiesEnabled: store.state.autoProxiesEnabled,
    autoProxyCountries: store.state.autoProxyCountries,
    autoProxyPoolSize: store.state.autoProxyPoolSize,
    autoProxySourceUrls: store.state.autoProxySourceUrls,
    backupStreamsAllowLowQuality: store.state.backupStreamsAllowLowQuality,
    backupStreamsEnabled: store.state.backupStreamsEnabled,
    customPassport: store.state.customPassport,
    customPassportEnabled: store.state.customPassportEnabled,
    declineDisplayAds: store.state.declineDisplayAds,
    normalProxies: store.state.normalProxies,
    optimizedProxies: store.state.optimizedProxies,
    optimizedProxiesEnabled: store.state.optimizedProxiesEnabled,
    passportLevel: store.state.passportLevel,
    userExperienceMode: store.state.userExperienceMode,
    userExperienceOverridenOptions: store.state.userExperienceOverridenOptions,
    whitelistChannelSubscriptions: store.state.whitelistChannelSubscriptions,
    whitelistedChannels: store.state.whitelistedChannels,
  };
  saveFile(
    "ttv-lol-pro_backup.json",
    JSON.stringify(state, null, 2),
    "application/json"
  );
});

importButtonElement.addEventListener("click", async () => {
  const DEFAULT_STATE_KEYS = Object.keys(DEFAULT_STATE);

  try {
    const data = await readFile("application/json");
    const state = JSON.parse(data);

    for (const entry of Object.entries(state)) {
      const key = entry[0] as keyof State;
      const value = entry[1];

      if (!DEFAULT_STATE_KEYS.includes(key)) {
        console.warn(`Unknown key '${key}' in imported settings`);
        continue;
      }
      let filteredValue = value;
      if (key === "optimizedProxies" && Array.isArray(value)) {
        filteredValue = value.filter(item =>
          item != null ? isOptimizedProxyUrlAllowed(item.toString())[0] : false
        );
      }
      if (key === "normalProxies" && Array.isArray(value)) {
        filteredValue = value.filter(item =>
          item != null ? isNormalProxyUrlAllowed(item.toString())[0] : false
        );
      }
      if (key === "passportLevel") {
        if (typeof value !== "number") {
          filteredValue = DEFAULT_STATE.passportLevel;
        } else {
          filteredValue = Math.min(Math.max(value, 0), 2);
        }
      }
      // @ts-ignore
      store.state[key] = filteredValue;
    }
    window.location.reload(); // Reload page to update UI.
  } catch (error) {
    alert(`An error occurred while importing settings: ${error}`);
  }
});

resetButtonElement.addEventListener("click", () => {
  const confirmation = confirm(
    "Are you sure you want to reset all settings to their default values?"
  );
  if (!confirmation) return;
  store.clear();
  window.location.reload(); // Reload page to update UI.
});

viewStatusOfProxiesButtonElement.addEventListener("click", () => {
  location.href = "https://status.perfprod.com/";
});

clearSessionStorageButtonElement.addEventListener("click", () => {
  onStartupStoreCleanup();
  alert("Session storage cleared successfully.");
});

unsetPacScriptButtonElement.addEventListener("click", () => {
  if (isChromium) {
    clearProxySettings();
    alert("PAC script unset successfully.");
  }
});

generateTwitchTabsReportButtonElement.addEventListener("click", async () => {
  let report = "**Twitch Tabs Report**\n\n";

  const extensionInfo = await browser.management.getSelf();
  const userAgentParser = Bowser.getParser(window.navigator.userAgent);
  report += `Extension: ${extensionInfo.name} ${extensionInfo.version}${
    process.env.BETA ? " Beta " + process.env.BETA : ""
  } (${extensionInfo.installType})\n`;
  report += `Browser: ${userAgentParser.getBrowserName()} ${userAgentParser.getBrowserVersion()} (${userAgentParser.getOSName()} ${userAgentParser.getOSVersion()})\n\n`;

  const openedTabs = await browser.tabs.query({
    url: ["https://www.twitch.tv/*", "https://m.twitch.tv/*"],
  });
  const detectedTabs = store.state.openedTwitchTabs;

  // Print all opened tabs.
  report += `Opened Twitch tabs (${openedTabs.length}):\n`;
  for (const tab of openedTabs) {
    report += `- ${tab.url || tab.pendingUrl} (id: ${tab.id}, windowId: ${
      tab.windowId
    })\n`;
  }
  report += "\n";

  // Whitelisted tabs in `openedTabs`.
  const openedWhitelistedTabs = openedTabs.filter(tab => {
    const url = tab.url || tab.pendingUrl;
    if (!url) return false;
    const channelName = findChannelFromTwitchTvUrl(url);
    const isWhitelisted = channelName
      ? isChannelWhitelisted(channelName)
      : false;
    return isWhitelisted;
  });
  report += `Out of the ${openedTabs.length} opened Twitch tabs, ${
    openedWhitelistedTabs.length
  } ${openedWhitelistedTabs.length === 1 ? "is" : "are"} whitelisted:\n`;
  for (const tab of openedWhitelistedTabs) {
    report += `- ${tab.url || tab.pendingUrl} (id: ${tab.id}, windowId: ${
      tab.windowId
    })\n`;
  }
  report += "\n";

  // Check for missing tabs in `detectedTabs`.
  const missingTabs = openedTabs.filter(
    tab => !detectedTabs.some(extensionTab => extensionTab.id === tab.id)
  );
  if (missingTabs.length > 0) {
    report += `The following Twitch tabs are missing from \`store.state.openedTwitchTabs\`:\n`;
    for (const tab of missingTabs) {
      report += `- ${tab.url || tab.pendingUrl} (id: ${tab.id}, windowId: ${
        tab.windowId
      })\n`;
    }
    report += "\n";
  } else {
    report +=
      "All opened Twitch tabs are present in `store.state.openedTwitchTabs`.\n\n";
  }

  // Check for extra tabs in `detectedTabs`.
  const extraTabs = detectedTabs.filter(
    extensionTab => !openedTabs.some(tab => tab.id === extensionTab.id)
  );
  if (extraTabs.length > 0) {
    report += `The following Twitch tabs are extra in \`store.state.openedTwitchTabs\`:\n`;
    for (const tab of extraTabs) {
      report += `- ${tab.url || tab.pendingUrl} (id: ${tab.id}, windowId: ${
        tab.windowId
      })\n`;
    }
    report += "\n";
  } else {
    report += "No extra Twitch tabs in `store.state.openedTwitchTabs`.\n\n";
  }

  // Whitelisted tabs in `detectedTabs`.
  const detectedWhitelistedTabs = detectedTabs.filter(tab => {
    const url = tab.url || tab.pendingUrl;
    if (!url) return false;
    const channelName = findChannelFromTwitchTvUrl(url);
    const isWhitelisted = channelName
      ? isChannelWhitelisted(channelName)
      : false;
    return isWhitelisted;
  });
  report += `Out of the ${
    detectedTabs.length
  } Twitch tabs in \`store.state.openedTwitchTabs\`, ${
    detectedWhitelistedTabs.length
  } ${detectedWhitelistedTabs.length === 1 ? "is" : "are"} whitelisted:\n`;
  for (const tab of detectedWhitelistedTabs) {
    report += `- ${tab.url || tab.pendingUrl} (id: ${tab.id}, windowId: ${
      tab.windowId
    })\n`;
  }
  report += "\n";

  // Should the PAC script be set?
  const allTabsAreWhitelisted =
    openedWhitelistedTabs.length === openedTabs.length;
  const shouldSetPacScript = openedTabs.length > 0 && !allTabsAreWhitelisted;
  report += `Should the PAC script be set? ${
    shouldSetPacScript ? "Yes" : "No"
  }\n`;
  report += `Is the PAC script set? ${
    store.state.chromiumProxyActive ? "Yes" : "No"
  }\n`;
  report += "\n";

  saveFile("ttv-lol-pro_tabs-report.txt", report, "text/plain;charset=utf-8");
  alert(
    "Report saved successfully. Please send it to the developer if requested."
  );
});

// Konami code to show expert mode option
// From https://stackoverflow.com/a/31627191

const konamiCode = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];
let konamiCodePosition = 0;

document.addEventListener("keydown", function (e) {
  const key = e.key;
  const expectedKey = konamiCode[konamiCodePosition];

  if (key == expectedKey) {
    konamiCodePosition += 1;

    // Complete code entered correctly.
    if (konamiCodePosition == konamiCode.length) {
      konamiCodeActivate();
      konamiCodePosition = 0;
    }
  } else {
    konamiCodePosition = 0;
  }
});

function konamiCodeActivate() {
  expertModeSegmentElement.removeAttribute("hidden");
}
