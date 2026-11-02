/*
 * Backup streams: ad-free copies of the same live stream, requested without
 * a proxy under a different player type.
 *
 * Which session Twitch stitches ads into is decided by the `playerType` and
 * `platform` of the playback access token, the only client-chosen fields
 * that reach the signed token. Measured 2026-11-02 on 8 live channels, same
 * conditions (no device ID, which reliably draws the preroll on `site/web`):
 *
 *   site/web             ads on 4 of 8   1080p
 *   mobile_feed/android  ads on 0 of 8   1080p
 *   popout/web           ads on 0 of 8   1080p
 *   embed/web            ads on 0 of 8   1080p
 *   autoplay/android     ads on 0 of 8   360p (Twitch caps the ladder)
 *
 * Same technique as the vaft userscript family (pixeltris/TwitchAdSolutions,
 * MIT); order and the android pairing follow scamorza/TwitchAdBlock (MIT),
 * which found `mobile_feed` and `autoplay` come back stitched when asked as
 * `web`. Each request is its own ad decision, so one type can be clean when
 * another isn't: they're tried in order and each candidate is checked before
 * the player is switched to it.
 */

export interface BackupStream {
  playerType: string;
  platform: "web" | "android";
  lowQuality: boolean; // Twitch caps this one's ladder (360p).
}

export const BACKUP_STREAMS: readonly BackupStream[] = Object.freeze([
  { playerType: "mobile_feed", platform: "android", lowQuality: false },
  { playerType: "popout", platform: "web", lowQuality: false },
  { playerType: "embed", platform: "web", lowQuality: false },
  { playerType: "autoplay", platform: "android", lowQuality: true },
]);

export function getBackupStreams(allowLowQuality: boolean): BackupStream[] {
  return BACKUP_STREAMS.filter(stream => allowLowQuality || !stream.lowQuality);
}

export interface StreamVariant {
  uri: string;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  codecs: string | null;
  codecFamily: string | null;
}

/**
 * Splits an attribute list (`A=1,B="x,y",C=z`), honouring quoted commas.
 */
function parseAttributes(list: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(list)) !== null) {
    attributes[match[1]] = match[2].replace(/^"|"$/g, "");
  }
  return attributes;
}

/**
 * The variants of an HLS master playlist (Usher response), in order.
 */
export function parseMasterPlaylist(text: string): StreamVariant[] {
  const lines = text.replace(/\r/g, "").split("\n");
  const variants: StreamVariant[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].startsWith("#EXT-X-STREAM-INF:")) continue;
    const uri = lines[i + 1].trim();
    if (!uri || uri.startsWith("#")) continue;
    const attributes = parseAttributes(
      lines[i].slice("#EXT-X-STREAM-INF:".length)
    );
    const [width, height] = (attributes["RESOLUTION"] ?? "")
      .split("x")
      .map(Number);
    const frameRate = Number(attributes["FRAME-RATE"]);
    const codecs = attributes["CODECS"] ?? null;
    variants.push({
      uri,
      width: Number.isFinite(width) && width > 0 ? width : null,
      height: Number.isFinite(height) && height > 0 ? height : null,
      frameRate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null,
      codecs,
      codecFamily: getCodecFamily(codecs),
    });
  }
  return variants;
}

/**
 * Video codec family of a CODECS attribute: "avc", "hevc", "av1", or the
 * base name of anything else. Variants of different families can't replace
 * each other: a player decoding AVC stops dead when handed HEVC segments.
 */
export function getCodecFamily(
  codecs: string | null | undefined
): string | null {
  if (!codecs) return null;
  const video = codecs
    .split(",")
    .map(codec => codec.trim().toLowerCase())
    .find(codec => !codec.startsWith("mp4a") && !codec.startsWith("opus"));
  if (!video) return null;
  const base = video.split(".")[0];
  if (base === "hev1" || base === "hvc1") return "hevc";
  if (base.startsWith("avc")) return "avc";
  if (base === "av01") return "av1";
  return base;
}

/**
 * Maps each quality the player knows (`assignedMap`, key → URL of the
 * original session) to the closest variant of the backup session with the
 * same codec family: same height if it exists, else the nearest one, ties
 * going to the nearer frame rate and then to the higher resolution.
 *
 * A quality with no codec-compatible backup variant is left out, so the
 * caller can tell that the backup can't serve it.
 */
export function buildBackupReplacementMap(
  assignedMap: Map<string, string>,
  assignedVariants: StreamVariant[],
  backupVariants: StreamVariant[]
): Map<string, string> {
  const replacementMap = new Map<string, string>();
  for (const [key, uri] of assignedMap) {
    const assigned = assignedVariants.find(variant => variant.uri === uri);
    const family = assigned?.codecFamily ?? null;
    const pool = family
      ? backupVariants.filter(variant => variant.codecFamily === family)
      : backupVariants;
    if (pool.length === 0) continue;

    const height = assigned?.height ?? null;
    const frameRate = assigned?.frameRate ?? null;
    const distance = (variant: StreamVariant) =>
      height != null && variant.height != null
        ? Math.abs(variant.height - height)
        : 0;
    const frameRateDistance = (variant: StreamVariant) =>
      frameRate != null && variant.frameRate != null
        ? Math.abs(variant.frameRate - frameRate)
        : 0;
    const best = [...pool].sort(
      (a, b) =>
        distance(a) - distance(b) ||
        frameRateDistance(a) - frameRateDistance(b) ||
        (b.height ?? 0) - (a.height ?? 0)
    )[0];
    replacementMap.set(key, best.uri);
  }
  return replacementMap;
}

export function mediaPlaylistHasAd(text: string): boolean {
  return text.toLowerCase().includes("stitched-ad");
}
