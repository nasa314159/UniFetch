# Supported content

Two runtimes have different capabilities. The tiers below are deliberately separate.

| Platform/content                    | Web/PWA (`unifetch.pages.dev`)                | Chromium extension (GitHub Releases ZIP, unpacked)                                    |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| Instagram Post (single image)       | Public metadata via Resolver (tested samples) | Authenticated resolution + download (previously physically verified)                  |
| Instagram Carousel                  | Public metadata via Resolver (tested samples) | Authenticated multi-asset resolution + sequential download (previously verified)      |
| Instagram Reel                      | Public metadata via Resolver (tested samples) | Authenticated resolution + download (previously verified)                             |
| Instagram Story — explicit media id | Not supported                                 | One image or video per explicit `/stories/<username>/<id>/` URL (previously verified) |
| Instagram Story — username only     | Not supported                                 | **Unsupported — fails closed before any request**                                     |
| Instagram Highlights                | Not supported                                 | Not supported                                                                         |
| Facebook                            | Planned only                                  | Not implemented                                                                       |
| Threads                             | Planned only                                  | Not implemented                                                                       |

Demo IDs are unifetch-demo-image, unifetch-demo-carousel and unifetch-demo-reel. Authors/captions are fictional; artwork/clips were generated locally. Demo previews and downloads remain functional without a metadata Resolver.

## Web/PWA

Public HTTPS `/p/`, `/reel/` and `/reels/` links use the existing Polaris profile through `POST /api/resolve`. The Worker accepts canonical/www Instagram hosts for these paths and the mobile host for posts. It returns direct media URLs and normalized metadata, never media files. Missing configuration or upstream restrictions produce explicit typed failures. Endpoint stability and public accessibility do not guarantee metadata success, preview or download. There is no login/private-account support or alternate profile on the Web/PWA.

The M4C direct-browser feasibility probes for public Image, Carousel and Reel all returned BROWSER_RESTRICTION in the tested environment. M4D was intentionally skipped because M4C established the runtime decision. M5 routes normal live metadata through the Resolver. The Web/PWA does not advertise or expose authenticated extension capabilities.

Carousel downloads are individual sequential requests after selection/Download all. No media proxy/cache, ZIP, transcoding, audio extraction, crawling or bulk discovery is included.

## Chromium extension

The extension is an MV3 build distributed as a versioned GitHub Releases ZIP and loaded manually as an unpacked extension. It is not listed in the Chrome Web Store, requires Developer mode and does not auto-update; the install guide is `https://unifetch.pages.dev/extension`. It uses the user's existing Instagram browser session through normal credentialed requests; it never reads or exports cookies, tokens or session storage.

- **Post / Carousel / Reel:** background fetch first, then isolated content script, then MAIN world. The existing Resolver parser/normalizer is reused. Carousel assets download sequentially in their original order.
- **Story:** only an explicit media id URL is accepted. The extension calls `GET /api/v1/media/<id>/info/` and downloads exactly one image or one video. It never enumerates a Story reel.
- **Owner validation:** the response publisher must match the username in the Story route. A mismatch is rejected as `UNSUPPORTED_CONTENT`; no asset URL is returned to the popup and nothing is downloaded.
- **Username-only Stories:** `/stories/<username>/` is refused before any request. There is no DOM, React, fiber, history-state or visible-media fallback in the stable release.
- **Unsupported Story cases:** Highlights, username-only URLs, multi-item responses and MSE/blob-only video playback are not downloaded.

Previously performed physical validation (not repeated during the stabilization session) covered authenticated Post/Carousel/Reel resolution/download and explicit-id Story image/video downloads. Automated tests cover identity rejection, explicit-id success and username-only fail-closed behavior; they do not prove live Instagram behavior.

## Verified status language

- **Implemented:** code exists and builds.
- **Automated-test verified:** covered by `pnpm test` in this repository.
- **Physically verified:** observed on a real device/browser in an earlier milestone. Not re-run in this stabilization session.
- **Partially supported:** works only under a narrower condition (for example, explicit-id Story only).
- **Deferred:** intentionally not implemented now.
- **Unsupported:** refused by design.

M5–M5.5 local validation established successful metadata resolution for the tested public Instagram image post, carousel and Reel, direct image preview, direct image Blob download and Open original. The Cloudflare Resolver is the current Web/PWA compatibility runtime for metadata; media is fetched directly by the user’s browser/device. These tests do not establish support for all public content or live video downloads. No public identifiers or raw response payloads were retained in source, fixtures or documentation.
