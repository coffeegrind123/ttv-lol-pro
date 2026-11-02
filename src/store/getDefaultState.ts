import {
  DEFAULT_AUTO_PROXY_POOL_SIZE,
  DEFAULT_AUTO_PROXY_SOURCE_URLS,
  getDefaultAutoProxyCountries,
} from "../common/ts/autoProxy/constants";
import isChromium from "../common/ts/isChromium";
import type { State } from "./types";

export default function getDefaultState() {
  const state: State = {
    activeChannelSubscriptions: [],
    adLog: [],
    adLogEnabled: true,
    adLogLastSent: 0,
    allowOtherProxyProtocols: false,
    anonymousMode: true,
    autoProxies: [],
    autoProxiesEnabled: true,
    autoProxyCountries: getDefaultAutoProxyCountries(),
    autoProxyLastRefresh: 0,
    autoProxyPoolSize: DEFAULT_AUTO_PROXY_POOL_SIZE,
    autoProxyRejected: {},
    autoProxySourceUrls: [...DEFAULT_AUTO_PROXY_SOURCE_URLS],
    autoProxyStatus: {
      state: "idle",
      message: "",
      reason: null,
      listSize: 0,
      candidates: 0,
      tested: 0,
      accepted: 0,
      updatedAt: 0,
    },
    chromiumProxyActive: false,
    completedSetupVersion: 0,
    customPassport: {
      passport: false,
      usher: false,
      videoWeaver: false,
      graphQLToken: false,
      graphQLIntegrity: false,
      graphQLAll: false,
      twitchWebpage: false,
    },
    customPassportEnabled: false,
    dnsResponses: [],
    lastStoreCleanupTimestamp: 0,
    normalProxies: getDefaultNormalProxies(),
    openedTwitchTabs: [],
    optimizedProxies: getDefaultOptimizedProxies(),
    optimizedProxiesEnabled: true,
    passportLevel: 0,
    streamStatuses: {},
    userExperienceMode: "blockAds",
    userExperienceOverridenOptions: {},
    videoWeaverUrlsByChannel: {},
    whitelistChannelSubscriptions: true,
    whitelistedChannels: [],
  };
  return state;
}

function getDefaultNormalProxies(): string[] {
  const normalProxies: string[] = [];
  if (
    process.env.NODE_ENV === "development" &&
    process.env.DEV_NORMAL_PROXIES
  ) {
    normalProxies.unshift(
      ...process.env.DEV_NORMAL_PROXIES.split(",")
        .map(s => s.trim())
        .filter(s => !!s)
    );
  }
  return normalProxies;
}

function getDefaultOptimizedProxies(): string[] {
  const optimizedProxies: string[] = isChromium
    ? ["chromium.api.cdn-perfprod.com:2023"]
    : ["firefox.api.cdn-perfprod.com:2023"];
  if (
    process.env.NODE_ENV === "development" &&
    process.env.DEV_OPTIMIZED_PROXIES
  ) {
    optimizedProxies.unshift(
      ...process.env.DEV_OPTIMIZED_PROXIES.split(",")
        .map(s => s.trim())
        .filter(s => !!s)
    );
  }
  return optimizedProxies;
}
