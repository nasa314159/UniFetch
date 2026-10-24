# Supported content

Two runtimes have different capabilities. The tiers below are deliberately separate.

| Platform/content                          | Web/PWA (`unifetch.pages.dev`)                                                 | Chromium extension (GitHub Releases ZIP, unpacked)                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Instagram Post (single image)             | Public metadata via Resolver (tested samples)                                  | Authenticated resolution + download (previously physically verified)                  |
| Instagram Carousel                        | Public metadata via Resolver (tested samples)                                  | Authenticated multi-asset resolution + sequential download (previously verified)      |
| Instagram Reel                            | Public metadata via Resolver (tested samples)                                  | Authenticated resolution + download (previously verified)                             |
| Instagram Story — explicit media id       | Not supported                                                                  | One image or video per explicit `/stories/<username>/<id>/` URL (previously verified) |
| Instagram Story — username only           | Not supported                                                                  | **Unsupported — fails closed before any request**                                     |
| Instagram Highlights                      | Not supported                                                                  | Not supported                                                                         |
| Facebook                                  | Planned only                                                                   | Not implemented                                                                       |
| Threads Post — single image               | Public metadata via Resolver (production-verified sample)                      | Not implemented                                                                       |
| Threads Post — image carousel             | Public metadata via Resolver (tested samples)                                  | Not implemented                                                                       |
| Threads Post — native video               | Public metadata via Resolver (production-verified sample)                      | Not implemented                                                                       |
| Threads Post — mixed image/video carousel | Public metadata via Resolver (production-verified sample)                      | Not implemented                                                                       |
| Threads Post — GIF-like animation         | Public metadata + exact-post embed fallback (production-verified Giphy sample) | Not implemented                                                                       |
| Threads Post — audio-only                 | Deferred / not supported                                                       | Not implemented                                                                       |

Demo IDs are unifetch-demo-image, unifetch-demo-carousel and unifetch-demo-reel. Authors/captions are fictional; artwork/clips were generated locally. Demo previews and downloads remain functional without a metadata Resolver.

## Web/PWA

Public HTTPS `/p/`, `/reel/` and `/reels/` links use the existing Polaris profile through `POST /api/resolve`. The Worker accepts canonical/www Instagram hosts for these paths and the mobile host for posts. It returns direct media URLs and normalized metadata, never media files. Missing configuration or upstream restrictions produce explicit typed failures. Endpoint stability and public accessibility do not guarantee metadata success, preview or download. There is no login/private-account support or alternate profile on the Web/PWA.

The M4C direct-browser feasibility probes for public Image, Carousel and Reel all returned BROWSER_RESTRICTION in the tested environment. M4D was intentionally skipped because M4C established the runtime decision. M5 routes normal live metadata through the Resolver. The Web/PWA does not advertise or expose authenticated extension capabilities.

Carousel downloads are individual sequential requests after selection/Download all. No media proxy/cache, ZIP, transcoding, audio extraction, crawling or bulk discovery is included.

### Threads on the Web/PWA

The Worker accepts only one canonical public Threads post permalink:

- `https://www.threads.com/@<username>/post/<shortcode>/`
- verified aliases `threads.net`, `www.threads.net` and `threads.com` are normalized to `www.threads.com`
- trailing slash, one decorative slug segment and `/media` are accepted and canonicalized to the post

Profiles, replies/profile tabs, search/discovery, `/t/` short links, `/share/` links, embed URLs as user input, compose intents, quoted/reposted substitution and private/login content are refused. The Worker fetches only the constructed canonical URL, with redirects disabled, credentials omitted, a 4 MiB HTML bound and a 10-second timeout. It never fetches or proxies media bytes.

The Threads parser requires the response's root `data.media.code` to match the requested shortcode and its `user.username` to match the requested publisher. Assets preserve source order. Direct JPEG and MP4 CDN URLs are returned; video poster images are never substituted for video. GIF-like posts (`media_type: 19`) initially expose a static placeholder, so the Worker reads the exact post's public embed page, verifies the same post and publisher, and extracts the direct Giphy GIF URL from the embed's image proxy parameter. The placeholder and Open Graph image are never treated as the GIF. The browser downloads the direct GIF bytes and keeps the animated GIF format.

T1B live-validated a public single image, 20-image carousel, native video, video carousel child and GIF post through local `workerd` and a `wrangler dev --remote` Cloudflare edge session. T1C then deployed the same code to the existing production Worker and Pages project and rechecked it from `https://unifetch.pages.dev`. Production smoke tests resolved a single image, a native MP4 post (including playable preview), a three-asset mixed carousel ordered as video/video/image, and a Giphy GIF. Browser downloads produced a JPEG, an MP4, three ordered carousel files and a 17-frame animated GIF (259×200, 136,696 bytes); the Worker was not in the media path. These are tested samples; no universal coverage or private-content support is claimed.

Known Threads limitations remain: `/t/` short links, `/share/` links, profiles, search/discovery, replies and quoted/reposted substitution are unsupported; audio-only posts, private/login-required posts, animated WebP and non-Giphy GIF providers are unsupported or unverified. GIF support is limited to Giphy attachments observed through the exact-post embed and may return only the reduced-height variant offered by the embed. Mixed carousels preserve the source order and per-child media type, but each asset is still fetched directly from the CDN and is subject to its browser/CORS behavior.

## Chromium extension

The extension is an MV3 build distributed as a versioned GitHub Releases ZIP and loaded manually as an unpacked extension. It is not listed in the Chrome Web Store, requires Developer mode and does not auto-update; the install guide is `https://unifetch.pages.dev/extension`. It uses the user's existing Instagram browser session through normal credentialed requests; it never reads or exports cookies, tokens or session storage.

- **Post / Carousel / Reel:** background fetch first, then isolated content script, then MAIN world. The existing Resolver parser/normalizer is reused. Carousel assets download sequentially in their original order.
- **Story:** only an explicit media id URL is accepted. The extension calls `GET /api/v1/media/<id>/info/` and downloads exactly one image or one video. It never enumerates a Story reel.
- **Owner validation:** the response publisher must match the username in the Story route. A mismatch is rejected as `UNSUPPORTED_CONTENT`; no asset URL is returned to the popup and nothing is downloaded.
- **Username-only Stories:** `/stories/<username>/` is refused before any request. There is no DOM, React, fiber, history-state or visible-media fallback in the stable release.
- **Unsupported Story cases:** Highlights, username-only URLs, multi-item responses and MSE/blob-only video playback are not downloaded.
- **Threads:** Not implemented in the extension and no Threads host permission is requested. Threads is a public Web/PWA resolver capability only.

Previously performed physical validation (not repeated during the stabilization session) covered authenticated Post/Carousel/Reel resolution/download and explicit-id Story image/video downloads. Automated tests cover identity rejection, explicit-id success and username-only fail-closed behavior; they do not prove live Instagram behavior.

## Verified status language

- **Implemented:** code exists and builds.
- **Automated-test verified:** covered by `pnpm test` in this repository.
- **Physically verified:** observed on a real device/browser in an earlier milestone. Not re-run in this stabilization session.
- **Partially supported:** works only under a narrower condition (for example, explicit-id Story only).
- **Deferred:** intentionally not implemented now.
- **Unsupported:** refused by design.

M5–M5.5 local validation established successful metadata resolution for the tested public Instagram image post, carousel and Reel, direct image preview, direct image Blob download and Open original. T1C released public Threads image, carousel, native video and Giphy GIF support through the same metadata-only Resolver and direct browser downloader. The T1C production recheck of sampled public Instagram URLs returned `LOGIN_REQUIRED` from the upstream platform, so live Instagram resolution is **not verified in this release**; the Instagram Worker path is unchanged and its automated regression tests pass. The Cloudflare Resolver is the current Web/PWA compatibility runtime for metadata; media is fetched directly by the user’s browser/device. These tests do not establish support for all public content. No public identifiers or raw response payloads were retained in source, fixtures or documentation.
