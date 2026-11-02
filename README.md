<h1 align="center">
  <img alt="Icon" src="src/common/images/brand/icon.png" height="100" width="100" />
  <br />
  TTV LOL PRO (auto-proxy fork)
</h1>

<p align="center">
  Blocks Twitch livestream ads with no setup: install it and watch.
  <br />
  <a href="https://github.com/coffeegrind123/ttv-lol-pro/releases/latest"><b>Download</b></a>
  ·
  <a href="#how-it-blocks-ads">How it works</a>
  ·
  <a href="#settings">Settings</a>
</p>

A fork of [TTV LOL PRO](https://github.com/younesaassila/ttv-lol-pro). Upstream needs a proxy in an ad-free country, which most people don't have. This fork finds and checks free proxies by itself. When none works, it falls back to ad-free copies of the stream that need no proxy at all. It also blocks the display ads around the player.

Everything upstream does still works: your own proxies, whitelisted channels, the stream status popup, and the ad log.

## Install

Get the zip for your browser from the [release](https://github.com/coffeegrind123/ttv-lol-pro/releases/latest). There is only ever one release, always built from the latest `main`.

- **Chrome, Edge, Brave, Opera:** unzip `ttv-lol-pro-chromium.zip`. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick the folder.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and pick `ttv-lol-pro-firefox.zip`. The build is unsigned, so regular Firefox removes it on restart. In [Firefox Developer Edition](https://www.mozilla.org/firefox/developer/) or Nightly, set `xpinstall.signatures.required` to `false` in `about:config` to install it permanently.

Then reload any open Twitch tabs.

> [!WARNING]
> Remove other Twitch ad blockers first, including the store version of TTV LOL PRO and any vaft userscript. Two of them fight over the same requests. [uBlock Origin](https://ublockorigin.com/) alongside is fine.

## How it blocks ads

Twitch stitches ads into the video stream itself, so normal ad blockers can't see them. This fork uses three layers, each picking up what the previous one misses.

### 1. Automatic proxies in ad-free countries

Twitch decides whether to stitch ads by where the viewer appears to be, and some countries get none. The extension handles the proxies on its own:

1. **Finds them:** it downloads hourly public proxy lists from [proxy-scraper](https://github.com/maximilianfeix/proxy-scraper). One is pre-checked against Twitch ([`twitch-list`](https://github.com/coffeegrind123/proxy-scraper/tree/twitch-list)); the [full list](https://proxy-scraper.de/proxies.json) is the fallback.
2. **Tests each one from your browser, through the proxy:** playback token, then stream manifest, then media playlist. A proxy is kept only if it connects and gets past Twitch's CDN, which turns most public proxies away. Twitch must also place it in a selected country (`USER-COUNTRY`), whatever the list says.
3. **Uses the working ones first,** ahead of any proxies you added yourself.
4. **Replaces proxies** that let an ad through, or that Twitch places in another country during playback.
5. **Rechecks** on install, at browser start and every 30 minutes, and refills when fewer than 3 work.

Only ad requests go through a proxy. The rest of your Twitch traffic goes direct.

### 2. Ad-free backup streams, no proxy needed

When an ad still gets through, or no proxy works, the extension switches to another copy of the same live stream for the rest of the break.

Which session Twitch puts ads in depends on the player type in the playback token. The extension requests the stream as Twitch's other players, in this order: `mobile_feed` (as Android), `popout`, `embed`, and `autoplay` last (capped at 360p). It checks each copy for ads before switching. It only uses a copy in the codec your player is already decoding (AVC, HEVC or AV1). A 360p copy is dropped as soon as the break ends.

Measured on 8 live channels under the same conditions, the normal web player (`site`) got ads on 4 of them. The backup player types got ads on none, at 1080p, except `autoplay`.

### 3. Display ads

Twitch also shows ads next to the stream: above chat, squeezeback, lower third, and pause ads. Your browser requests those, not the stream. The extension tells Twitch's own ad manager to decline them, so they're never requested.

## Countries without ads

From the TTV LOL PRO knowledge base's [list of known ad-free countries](https://wiki.cdn-perfprod.com/guides/proxy/host-your-own-proxy):

|                                                             | Countries                                                                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ad-free** (no ads recorded in 12 months, used by default) | Russia\*, South Korea\*, Albania, Moldova, Belarus, Romania, Latvia, Lithuania, Estonia, Bulgaria, Slovenia, Iceland, Portugal, Croatia, North Macedonia, Georgia, Armenia, Kazakhstan, Seychelles |
| **Partially ad-free** (1–2 ads in 12 months, opt-in)        | Ukraine, Slovakia, Luxembourg, United Arab Emirates, Serbia, Poland, Egypt, Israel                                                                                                                 |

\* Twitch caps quality at 720p there. "Unlock Best Quality" mode therefore doesn't use automatic proxies.

## Settings

Everything below is on by default. Change it in the extension's options.

| Option                                        | What it does                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Find and use proxies automatically            | Layer 1. The status line says how many proxies work. "Why proxies were rejected" lists every rejected proxy and the reason. |
| Countries                                     | Which countries automatic proxies may exit in.                                                                              |
| Proxies to keep ready                         | How many working proxies to hold (default 5).                                                                               |
| Proxy lists                                   | Where proxies come from: proxy-scraper's JSON, or text with one `protocol://host:port` per line.                            |
| Switch to an ad-free backup stream during ads | Layer 2.                                                                                                                    |
| Allow a 360p backup as last resort            | Layer 2's `autoplay` step.                                                                                                  |
| Block display ads                             | Layer 3. Skipped on whitelisted channels; takes effect on the next page load.                                               |
| Whitelisted channels                          | Lets ads play on channels you want to support.                                                                              |

**Rejected proxies** are excluded for a while, depending on why they failed:

| Reason                                                  | Excluded for                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Blocked by Twitch's CDN, or placed in the wrong country | 6 hours (a property of the proxy's IP)                                 |
| Unreachable                                             | 1 hour                                                                 |
| Every proxy unreachable in a refresh                    | Not excluded: the cause is more likely your firewall, antivirus or ISP |

## Privacy

Free proxies are run by strangers. Twitch traffic stays encrypted end to end, so a proxy sees which Twitch servers you connect to, but not what you watch or your login. Anonymous mode, on by default, also keeps your account out of proxied token requests. See [PRIVACY.md](PRIVACY.md) for what the extension contacts and why.

## Building

```sh
npm install
npm run build:chromium   # or build:firefox; output in dist/webext-prod
npm run lint && npm run type-check
```

Every push to `main` is built by [CI](.github/workflows/build.yml), which replaces the single release with the new packages.

## Credits

- [TTV LOL PRO](https://github.com/younesaassila/ttv-lol-pro) by [Younes Aassila](https://github.com/younesaassila), with proxies and the ad-free country list by [Marc Gómez](https://github.com/zGato). This fork is built on their work.
- [proxy-scraper](https://github.com/maximilianfeix/proxy-scraper) by Maximilian Feix, for the hourly proxy lists.
- The backup-stream technique comes from the vaft userscript ([pixeltris/TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions)). The player-type order and the display-ad decline follow [scamorza/TwitchAdBlock](https://github.com/scamorza/TwitchAdBlock) (MIT).

Licensed under [GPL-3.0](COPYING), like upstream.
