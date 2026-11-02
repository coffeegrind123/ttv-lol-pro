import type { Tabs } from "webextension-polyfill";
import type {
  AdLogEntry,
  AutoProxyEntry,
  AutoProxyStatus,
  DnsResponse,
  PassportConfig,
  StreamStatus,
  UserExperienceMode,
} from "../types";

export type EventType = "load" | "change";
export type ReadyState = "loading" | "complete";
export type StorageAreaName = "local" | "managed" | "sync";

export interface State {
  activeChannelSubscriptions: string[];
  adLog: AdLogEntry[];
  adLogEnabled: boolean;
  adLogLastSent: number;
  allowOtherProxyProtocols: boolean;
  anonymousMode: boolean;
  autoProxies: AutoProxyEntry[];
  autoProxiesEnabled: boolean;
  autoProxyCountries: string[];
  autoProxyLastRefresh: number;
  autoProxyPoolSize: number;
  autoProxyRejected: Record<string, number>;
  autoProxySourceUrls: string[];
  autoProxyStatus: AutoProxyStatus;
  chromiumProxyActive: boolean;
  completedSetupVersion: number;
  customPassport: PassportConfig;
  customPassportEnabled: boolean;
  dnsResponses: DnsResponse[];
  lastStoreCleanupTimestamp: number;
  normalProxies: string[];
  openedTwitchTabs: Tabs.Tab[];
  optimizedProxies: string[];
  optimizedProxiesEnabled: boolean;
  passportLevel: number;
  streamStatuses: Record<string, StreamStatus>;
  userExperienceMode: UserExperienceMode;
  userExperienceOverridenOptions: Partial<
    Omit<State, "userExperienceOverridenOptions">
  >;
  videoWeaverUrlsByChannel: Record<string, string[]>;
  whitelistChannelSubscriptions: boolean;
  whitelistedChannels: string[];
}

export const enum ProxyFlags {
  IS_PROXY = "__isProxy",
  RAW = "__raw",
}
