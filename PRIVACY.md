# Privacy policy

## Proxy Services & Data Security

TTV LOL PRO routes certain Twitch requests through proxy servers using industry-standard protocols[^1]. Due to HTTPS encryption, the actual content of these requests remains unreadable and unmodifiable by the proxies. However, the proxies can still see the domain names associated with the requests.

## Default Proxy Logging

TTV LOL PRO includes default proxies that redirect Twitch traffic through ad-free regions. To prevent abuse and ensure service quality, these proxies may temporarily log IP addresses for up to 24 hours. These logs are strictly for security and operational purposes and are never sold or shared with third parties.

## Third-Party Proxy Use

Users who opt to use third-party proxies should be aware that these services operate under their own privacy policies, independent of TTV LOL PRO. Since TTV LOL PRO does not control these external providers, users are encouraged to review their policies before use.

## Automatic Proxies

When automatic proxies are enabled (the default in "Block Ads" mode), TTV LOL PRO downloads a public proxy list from proxy-scraper (`proxy-scraper.de`, with `cdn.jsdelivr.net` as a fallback) whenever it needs more working proxies, rechecks the proxies it uses every 30 minutes, and sends test requests to Twitch through the proxies on it. These proxies are run by unknown third parties. As with any proxy, they can see your IP address and the Twitch domain names requested through them, but not the encrypted content. No data about you is sent to the list's host beyond the download request itself. Automatic proxies can be turned off in the options.

## Local Ad-Bypass Logging

TTV LOL PRO logs instances where ads bypass the ad-blocking mechanism. These logs are stored locally on the user's device and can be viewed, disabled, or cleared through the extension’s settings. Users may choose to send these logs to the TTV LOL PRO developers for analysis. To minimize storage, log entries are automatically deleted after seven days.

[^1]: HTTP, HTTPS, SOCKS4, and SOCKS5
