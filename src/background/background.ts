import browser from "webextension-polyfill";
import {
  AUTO_PROXY_ALARM_NAME,
  AUTO_PROXY_REFRESH_PERIOD_MINUTES,
} from "../common/ts/autoProxy/constants";
import { refreshAutoProxies } from "../common/ts/autoProxy/manager";
import isChromium from "../common/ts/isChromium";
import checkForOpenedTwitchTabs from "./handlers/checkForOpenedTwitchTabs";
import onAuthRequired from "./handlers/onAuthRequired";
import onBeforeSendHeaders from "./handlers/onBeforeSendHeaders";
import onContentScriptMessage from "./handlers/onContentScriptMessage";
import onInstalled from "./handlers/onInstalled";
import onProxyRequest from "./handlers/onProxyRequest";
import onResponseStarted from "./handlers/onResponseStarted";
import onStartupStoreCleanup from "./handlers/onStartupStoreCleanup";
import onTabCreated from "./handlers/onTabCreated";
import onTabRemoved from "./handlers/onTabRemoved";
import onTabReplaced from "./handlers/onTabReplaced";
import onTabUpdated from "./handlers/onTabUpdated";

console.info("🚀 Background script loaded.");

// Cleanup old data in the store on update & open setup on install/update.
browser.runtime.onInstalled.addListener(onInstalled);

// Cleanup session data in the store on startup.
browser.runtime.onStartup.addListener(onStartupStoreCleanup);

// Automatic proxies: verify the pool on install/startup, then every
// AUTO_PROXY_REFRESH_PERIOD_MINUTES. `alarms.create` with an existing name
// replaces the alarm, so re-registering on every wake is harmless.
browser.alarms.create(AUTO_PROXY_ALARM_NAME, {
  delayInMinutes: AUTO_PROXY_REFRESH_PERIOD_MINUTES,
  periodInMinutes: AUTO_PROXY_REFRESH_PERIOD_MINUTES,
});
browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === AUTO_PROXY_ALARM_NAME) refreshAutoProxies("alarm");
});
browser.runtime.onInstalled.addListener(details => {
  if (details.reason === "install" || details.reason === "update") {
    refreshAutoProxies("install");
  }
});
browser.runtime.onStartup.addListener(() => refreshAutoProxies("startup"));

// Listen to messages from the content script.
browser.runtime.onMessage.addListener(onContentScriptMessage);

// Handle proxy authentication.
browser.webRequest.onAuthRequired.addListener(
  onAuthRequired,
  {
    urls: [
      "https://*.live-video.net/*",
      "https://*.ttvnw.net/*",
      "https://*.twitch.tv/*",
    ],
  },
  ["blocking"]
);

// Monitor proxied status of requests.
browser.webRequest.onResponseStarted.addListener(onResponseStarted, {
  urls: [
    "https://*.live-video.net/*",
    "https://*.ttvnw.net/*",
    "https://*.twitch.tv/*",
  ],
});

if (isChromium) {
  // Check if there are any opened Twitch tabs on startup.
  checkForOpenedTwitchTabs();

  // Keep track of opened Twitch tabs to enable/disable the PAC script.
  browser.tabs.onCreated.addListener(onTabCreated);
  browser.tabs.onUpdated.addListener(onTabUpdated);
  browser.tabs.onRemoved.addListener(onTabRemoved);
  browser.tabs.onReplaced.addListener(onTabReplaced);
} else {
  // Block tracking pixels.
  browser.webRequest.onBeforeRequest.addListener(
    () => ({ cancel: true }),
    {
      urls: ["https://*.twitch.tv/r/s/*", "https://*.twitch.tv/r/c/*"],
    },
    ["blocking"]
  );

  // Proxy requests.
  browser.proxy.onRequest.addListener(
    onProxyRequest,
    {
      urls: [
        "https://*.live-video.net/*",
        "https://*.ttvnw.net/*",
        "https://*.twitch.tv/*",
      ],
    },
    ["requestHeaders"]
  );

  // Remove the Accept flag from flagged requests.
  browser.webRequest.onBeforeSendHeaders.addListener(
    onBeforeSendHeaders,
    {
      urls: [
        "https://*.live-video.net/*",
        "https://*.ttvnw.net/*",
        "https://*.twitch.tv/*",
      ],
    },
    ["blocking", "requestHeaders"]
  );
}
