import { Mutex } from "async-mutex";
import type { State } from "../store/types";
import { MessageType, ProxyRequestType } from "../types";
import type { BackupStream, StreamVariant } from "./backupStreams";

export type SendMessageFn = (message: any) => void;
export type SendMessageAndWaitForResponseFn = (
  scope: "page" | "worker",
  message: any,
  responseMessageType: MessageType,
  responseTimeout?: number
) => Promise<any>;

export interface PageState {
  params: any;
  isChromium: boolean;
  scope: "page" | "worker";
  state?: State;
  requestTypeMutexes: Record<ProxyRequestType, Mutex>;
  twitchWorkers: Worker[];
  sendMessageToContentScript: SendMessageFn;
  sendMessageToContentScriptAndWaitForResponse: SendMessageAndWaitForResponseFn;
  sendMessageToPageScript: SendMessageFn;
  sendMessageToPageScriptAndWaitForResponse: SendMessageAndWaitForResponseFn;
  sendMessageToWorkerScripts: SendMessageFn;
  sendMessageToWorkerScriptsAndWaitForResponse: SendMessageAndWaitForResponseFn;
}

export interface UsherManifest {
  channelName: string | null;
  assignedMap: Map<string, string>; // E.g. "720p60" -> "https://video-weaver.fra02.hls.ttvnw.net/v1/playlist/..."
  replacementMap: Map<string, string> | null; // Same as above, but with new URLs.
  consecutiveAdResponses: number; // Used to avoid infinite loops.
  consecutiveAdCooldown: number; // Used to avoid infinite loops.
  assignedVariants: StreamVariant[]; // Codec, resolution and frame rate of each assigned URL.
  backupIndex: number; // Next backup stream to try during the current ad break.
  backupStream: BackupStream | null; // Backup stream `replacementMap` points to, if any.
  deleted: boolean; // Deletion flag for cleanup.
}

export interface PlaybackAccessToken {
  value: string;
  signature: string;
  authorization: {
    isForbidden: boolean;
    forbiddenReasonCode: string;
  };
  __typename: string;
}
