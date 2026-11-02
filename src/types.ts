// From https://stackoverflow.com/a/51419293
export type KeyOfType<T, V> = keyof {
  [P in keyof T as T[P] extends V ? P : never]: any;
};

// From https://www.charpeni.com/blog/properly-type-object-keys-and-object-entries#solution-1
export type ObjectEntries<T> = Array<[keyof T, T[keyof T]]>;

export type ProxyType = "direct" | "http" | "https" | "socks" | "socks4";

// From https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/proxy/ProxyInfo
export interface ProxyInfo {
  type: ProxyType;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  proxyDNS?: boolean;
  failoverTimeout?: number;
  proxyAuthorizationHeader?: string;
  connectionIsolationKey?: string;
}

export interface AdLogEntry {
  timestamp: number;
  channelName: string | null;
  videoWeaverUrl: string;
  rawLine: string;
  parsedLine?: {
    adRollType: "PREROLL" | "MIDROLL";
    adUrl: string;
    adUrlHighlight?: string;
    adClickTrackingUrl: string;
    adClickTrackingUrlHighlight?: string;
    adLineItemId: string;
    adCommercialId?: string;
    adDsaAdvertiserId?: string;
    adDsaCampaignId?: string;
  };
  adIdentity?: {
    advertiserName: string;
    payerName: string;
    isIdentityVerified: boolean;
  } | null;
}

export interface StreamStatus {
  proxied: boolean;
  proxyHost?: string;
  proxyCountry?: string;
  reason: string;
  stats?: {
    proxied: number;
    notProxied: number;
  };
}

export interface DnsResponse {
  host: string;
  ips: string[];
  timestamp: number;
  ttl: number;
}

export interface DnsResponseJson {
  Status: number;
  TC: boolean; // Truncated
  RD: boolean; // Recursion Desired
  RA: boolean; // Recursion Available
  AD: boolean; // Authentic Data
  CD: boolean; // Checking Disabled
  Question: {
    name: string;
    type: number;
  }[];
  Answer: {
    name: string;
    type: number;
    TTL: number;
    data: string;
  }[];
}

export const enum MessageType {
  ContentScriptMessage = "TLP_ContentScriptMessage",
  PageScriptMessage = "TLP_PageScriptMessage",
  WorkerScriptMessage = "TLP_WorkerScriptMessage",
  GetStoreState = "TLP_GetStoreState",
  GetStoreStateResponse = "TLP_GetStoreStateResponse",
  EnableFullMode = "TLP_EnableFullMode",
  EnableFullModeResponse = "TLP_EnableFullModeResponse",
  DisableFullMode = "TLP_DisableFullMode",
  DisableFullModeResponse = "TLP_DisableFullModeResponse",
  UsherResponse = "TLP_UsherResponse",
  NewPlaybackAccessToken = "TLP_NewPlaybackAccessToken",
  NewPlaybackAccessTokenResponse = "TLP_NewPlaybackAccessTokenResponse",
  ChannelSubStatusChange = "TLP_ChannelSubStatusChange",
  UpdateAdLog = "TLP_UpdateAdLog",
  ClearStats = "TLP_ClearStats",
  ExtensionError = "TLP_ExtensionError",
  ProxiedAdDetected = "TLP_ProxiedAdDetected",
  AutoProxyRefresh = "TLP_AutoProxyRefresh",
  AutoProxyRefreshResponse = "TLP_AutoProxyRefreshResponse",
}

export const enum ProxyRequestType {
  Passport = "passport",
  Usher = "usher",
  VideoWeaver = "videoWeaver",
  GraphQL = "graphQL",
  GraphQLToken = "graphQLToken",
  GraphQLIntegrity = "graphQLIntegrity",
  GraphQLAll = "graphQLAll",
  TwitchWebpage = "twitchWebpage",
}

export type ProxyRequestParams =
  | {
      isChromium: true;
      optimizedProxiesEnabled: boolean;
      passportLevel: number;
      customPassport: PassportConfig | null;
      fullModeEnabled?: boolean;
    }
  | {
      isChromium: false;
      optimizedProxiesEnabled: boolean;
      passportLevel: number;
      customPassport: PassportConfig | null;
      isFlagged?: boolean;
    };

export type PassportConfig = Record<
  Exclude<ProxyRequestType, ProxyRequestType.GraphQL>,
  boolean
>;

export type UserExperienceMode =
  | "blockAds"
  | "unlockBestQuality"
  | "expertMode";

export type AutoProxyProtocol = Exclude<ProxyType, "direct" | "https">;

/**
 * A proxy picked automatically from the public proxy list and verified
 * against Twitch from this browser.
 */
export interface AutoProxyEntry {
  url: string; // `protocol://host:port`, as accepted by `getProxyInfoFromUrl`.
  listedCountry: string; // Country according to the proxy list (GeoIP).
  twitchCountry: string; // Country according to Twitch (`USER-COUNTRY`).
  exitIp: string | null; // `user_ip` from the playback access token.
  latencyMs: number; // Wall time of the full probe (token + usher + playlist).
  addedAt: number;
  lastCheckedAt: number;
  strikes: number;
}

/**
 * Why a probe rejected a proxy, grouped by what it says about the proxy:
 * - "cdn": Twitch's stream CDN turned it away (a property of its IP);
 * - "country": Twitch places it outside the selected countries;
 * - "leak": the request bypassed it;
 * - "twitch": it connected but Twitch answered with an error;
 * - "unreachable": no connection or a timeout (could be the proxy or the
 *   user's network);
 * - "playlist": the media playlist didn't load through it;
 * - "ads": real playback through it carried ads (a strike, not a probe).
 */
export type AutoProxyFailureKind =
  | "cdn"
  | "country"
  | "leak"
  | "twitch"
  | "unreachable"
  | "playlist"
  | "ads";

export interface AutoProxyFailure {
  url: string;
  kind: AutoProxyFailureKind;
  reason: string;
  at: number;
}

export type AutoProxyRefreshReason =
  | "install"
  | "startup"
  | "alarm"
  | "manual"
  | "settings"
  | "lowPool";

export interface AutoProxyStatus {
  state: "idle" | "fetching" | "probing" | "error";
  message: string;
  reason: AutoProxyRefreshReason | null;
  listSize: number; // Entries in the downloaded list.
  candidates: number; // Entries left after filtering.
  tested: number;
  accepted: number;
  updatedAt: number;
}
