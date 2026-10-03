# Supported content

| Platform/content   | Current support                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Instagram Post     | Local single-image fixture; public metadata resolved through configured UniFetch Resolver (tested samples)            |
| Instagram Carousel | Local image/image/video/image fixture; public metadata resolved through configured UniFetch Resolver (tested samples) |
| Instagram Reel     | Local portrait-video fixture; public metadata resolved through configured UniFetch Resolver (tested samples)          |
| Instagram Stories  | Unsupported                                                                                                           |
| Facebook           | Planned, detection only                                                                                               |
| Threads            | Planned, detection only                                                                                               |

Demo IDs are unifetch-demo-image, unifetch-demo-carousel and unifetch-demo-reel. Authors/captions are fictional; artwork/clips were generated locally. Demo previews and downloads remain functional without a metadata Resolver.

Public HTTPS `/p/`, `/reel/` and `/reels/` links use the existing Polaris profile through `POST /api/resolve`. The Worker accepts canonical/www Instagram hosts for these paths and the mobile host for posts. It returns direct media URLs and normalized metadata, never media files. Missing configuration or upstream restrictions produce explicit typed failures. Endpoint stability and public accessibility do not guarantee metadata success, preview or download. There is no login/private-account support or alternate profile.

The M4C direct-browser feasibility probes for public Image, Carousel and Reel all returned BROWSER_RESTRICTION in the tested environment. M4D was intentionally skipped because M4C established the runtime decision. M5 routes normal live metadata through the Resolver; no extension/native runtime is implemented.

Carousel downloads are individual sequential requests after selection/Download all. No media proxy/cache, ZIP, transcoding, audio extraction, crawling or bulk discovery is included.

M5–M5.5 local validation established successful metadata resolution for the tested public Instagram image post, carousel and Reel, direct image preview, direct image Blob download and Open original. The Cloudflare Resolver is the current Web/PWA compatibility runtime for metadata; media is fetched directly by the user’s browser/device. These tests do not establish support for all public content or live video downloads. No public identifiers or raw response payloads were retained in source, fixtures or documentation.
