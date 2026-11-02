<h1 align="center">
  <img alt="Icon" src="https://raw.githubusercontent.com/younesaassila/ttv-lol-pro/refs/heads/v2/src/common/images/brand/icon.png" height="100" width="100" />
  <br />
  TTV LOL PRO
  <br />
</h1>

<div align="center">
  <a href="https://github.com/younesaassila/ttv-lol-pro/issues">
    <img
      alt="GitHub issues"
      src="https://img.shields.io/github/issues/younesaassila/ttv-lol-pro"
    />
  </a>
  <a href="https://github.com/younesaassila/ttv-lol-pro/stargazers">
    <img
      alt="GitHub stars"
      src="https://img.shields.io/github/stars/younesaassila/ttv-lol-pro"
    />
  </a>
  <a
    href="https://chrome.google.com/webstore/detail/ttv-lol-pro/bpaoeijjlplfjbagceilcgbkcdjbomjd"
  >
    <img
      alt="Chrome Web Store"
      src="https://img.shields.io/chrome-web-store/users/bpaoeijjlplfjbagceilcgbkcdjbomjd"
    />
  </a>
  <a href="https://addons.mozilla.org/addon/ttv-lol-pro/">
    <img alt="Mozilla Add-on" src="https://img.shields.io/amo/dw/ttv-lol-pro" />
  </a>
</div>

<div align="center">
  <a href="https://discord.ttvlolpro.com/">
    <img
      alt="Discord server"
      src="https://dcbadge.limes.pink/api/server/AmtFTPwsyH"
    />
  </a>
</div>

<br />

<div align="center">
  <a
    href="https://chrome.google.com/webstore/detail/ttv-lol-pro/bpaoeijjlplfjbagceilcgbkcdjbomjd"
  >
    <img
      alt="Chrome Web Store"
      src="https://raw.githubusercontent.com/younesaassila/ttv-lol-pro/refs/heads/v2/src/common/images/badges/chrome_web_store.png"
      height="50"
    />
  </a>
  <a href="https://addons.mozilla.org/addon/ttv-lol-pro/">
    <img
      alt="Firefox Add-ons"
      src="https://raw.githubusercontent.com/younesaassila/ttv-lol-pro/refs/heads/v2/src/common/images/badges/firefox_addons.png"
      height="50"
    />
  </a>
</div>

<br />

> [!NOTE]
> Looking for TTV LOL PRO v1? [Click here](https://github.com/younesaassila/ttv-lol-pro/tree/v1).

TTV LOL PRO removes most livestream ads from Twitch.

TTV LOL PRO is a fork of TTV LOL that:

- uses an improved ad blocking method,
- uses standard HTTP proxies (thus improving proxy compatibility and your privacy),
- adds a stream status widget to the popup,
- lets you whitelist channels,
- lets you use your own proxies.

TTV LOL PRO does not remove banner ads, nor does it remove ads from VODs. Please use [uBlock Origin](https://ublockorigin.com/) alongside TTV LOL PRO. Without it, we can't guarantee the effectiveness of the extension.

Any questions? Please read the [wiki](https://wiki.ttvlolpro.com/) first.

## Screenshots

<details>
  <summary>Popup (Firefox)</summary>
  <div align="center">
    <img
      alt="Popup (Firefox)"
      src="https://github.com/younesaassila/ttv-lol-pro/assets/47226184/722b2e22-50b0-4fc7-bd7b-61be2e1b592d"
      height="550"
    />
  </div>
</details>

<details>
  <summary>Options page (Firefox)</summary>
  <div align="center">
    <img
      alt="Options page (Firefox)"
      src="https://github.com/younesaassila/ttv-lol-pro/assets/47226184/83d96fcf-a8b1-4193-9dbe-232bf9d99529"
      height="550"
    />
  </div>
</details>

## Automatic proxies

The "Block Ads" mode needs no setup: the extension finds proxies by itself.

1. On install, at browser start and every 30 minutes it rechecks the proxies it uses, and when fewer than it needs still work, downloads the hourly public proxy list from [proxy-scraper](https://github.com/maximilianfeix/proxy-scraper) (`proxy-scraper.de/proxies.json`).
2. It keeps HTTPS-capable proxies in countries where Twitch shows no ads. The list is the [TTV LOL PRO knowledge base's](https://wiki.cdn-perfprod.com/guides/proxy/host-your-own-proxy) "known ad-free countries"; partially ad-free countries can be added in the options.
3. It tests each one against Twitch from your browser, through the proxy itself: playback token, stream manifest, media playlist. A proxy is kept only if it answers, gets past Twitch's CDN (which turns most public proxies away), and Twitch itself places it in a selected country (`USER-COUNTRY`), whatever the list claimed.
4. The working ones are tried first, ahead of the proxies in the "Proxies" list, which stay as the fallback.
5. A proxy that lets an ad through, or that Twitch places in another country during playback, gets replaced.

A test request can't show whether a country is ad-free: Twitch decides that per viewer during real playback. That's why step 5 judges proxies by what actually plays. "Unlock Best Quality" doesn't use automatic proxies, since Russia and South Korea cap quality at 720p.

Free proxies are run by strangers. Twitch traffic stays encrypted end to end, so a proxy sees which Twitch servers you connect to, not what you watch. Automatic proxies can be turned off in the options.

## Installation

> [!WARNING]
> Please remove any other Twitch-specific ad blocker (this includes the [VAFT](https://github.com/pixeltris/TwitchAdSolutions#scripts) script). [uBlock Origin](https://ublockorigin.com/) is recommended as it is a general-purpose ad blocker. Please clear your browser's cache after installing the extension.

### Chrome Web Store

Download the extension from the [Chrome Web Store](https://chrome.google.com/webstore/detail/ttv-lol-pro/bpaoeijjlplfjbagceilcgbkcdjbomjd).

### Firefox Add-ons

Download the extension from [Firefox Add-ons](https://addons.mozilla.org/addon/ttv-lol-pro/).

### Manual installation

1. Download the version for your browser under the "Assets" section of the [latest release](https://github.com/younesaassila/ttv-lol-pro/releases).

1. - **Chrome _(Permanent)_:** Unzip > Go to `chrome://extensions` > Enable developer mode > Load unpacked
   - **Firefox all editions _(Temporary)_:** Go to `about:debugging#/runtime/this-firefox` > Load Temporary Add-on
   - **[Firefox Developer Edition](https://www.mozilla.org/en-US/firefox/developer/) _(Permanent)_:** Go to `about:config` > Set `xpinstall.signatures.required` to `false` > Extensions page > Gear > Install Add-on From File

## Contributing

Contributions are welcome! Please read the [contributing guidelines](CONTRIBUTING.md).

## Credits

Extension maintained by [Younes Aassila (@younesaassila)](https://github.com/younesaassila) [ [GitHub Sponsors](https://github.com/sponsors/younesaassila) ]

Proxies maintained by [Marc Gómez (@zGato)](https://github.com/zGato) [ [Ko-fi](https://ko-fi.com/zGato) | [GitHub Sponsors](https://github.com/sponsors/zGato) ]
