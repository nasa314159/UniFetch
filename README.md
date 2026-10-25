# UniFetch

Save media you can already access. Direct media. Transparently.

UniFetch is an open-source Vue 3 web interface and installable PWA that processes one URL explicitly supplied by the user. Demo fixtures work locally. Public Instagram Post, Carousel and Reel metadata, and public Threads post media (images, image carousels, native video and GIF-like animation), can be resolved by the open-source UniFetch Resolver within the tested public content scope. UniFetch does not proxy media files through its servers.

A separate Chromium MV3 extension performs authenticated Instagram Post, Carousel, Reel and explicit-id Story acquisition inside the user's own browser session, plus public-only Threads post media through a local adapter. The extension is distributed as a versioned, checksum-verified ZIP on GitHub Releases and loaded manually as an unpacked extension. It is not listed in the Chrome Web Store and is not part of the Web/PWA deployment; its Instagram authenticated capabilities are not available at `https://unifetch.pages.dev`. The installation guide is at [https://unifetch.pages.dev/extension](https://unifetch.pages.dev/extension).

M5 adds a metadata-only Cloudflare Worker using the existing centralized Polaris profile. T1B adds a separate Threads adapter that reads one public Threads permalink's server-rendered metadata and, when needed for a GIF, the exact post's public embed page. Neither path requires an Instagram/Threads account, and neither stores resolution history. Returned assets are direct source URLs, not relayed files. Both platform profiles are unstable; typed failures do not imply support for every public post. Live success is not guaranteed.

## Demo

Use the Image, Carousel and Reel buttons or paste:

- `https://www.instagram.com/p/unifetch-demo-image/`
- `https://www.instagram.com/p/unifetch-demo-carousel/`
- `https://www.instagram.com/reel/unifetch-demo-reel/`

Authors and captions are fictional. SVG artwork and MP4 clips were generated locally. Demo resolution remains network-free; preview and download request local application assets.

## Development

Use Node.js 22 or newer and pnpm 10 (pinned in package.json).

```sh
pnpm install
cp apps/web/.env.example apps/web/.env.local
pnpm dev:resolver
# In another terminal:
pnpm dev:web
```

The example sets `VITE_UNIFETCH_RESOLVER_URL=http://127.0.0.1:8787`. This variable is an origin, without a path, query or credentials. It is public configuration, not a secret. Local Wrangler development needs no Cloudflare account. Open the web app at http://127.0.0.1:5173. Without a configured Resolver, fixtures work and other supported URLs show a typed configuration error; there is no direct Instagram fallback.

```sh
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm format:check
pnpm --filter @unifetch/web preview
```

Build typechecks the web app/packages, produces `apps/web/dist`, typechecks/bundles the Worker through a Wrangler dry run, and builds the unpacked Chromium extension into `apps/extension/dist`. Automated tests use mocks and sanitized fixtures; they do not require a Cloudflare account or live platform content. Manual live validation is separate and transient. Worker output and local Wrangler state are ignored.

Extension release packaging is deterministic and only runs from a clean tree:

```sh
pnpm package:extension
# artifacts/unifetch-chromium-extension-vX.Y.Z.zip
# artifacts/unifetch-chromium-extension-vX.Y.Z.zip.sha256

node scripts/release-extension.mjs           # verify tag, commit, checksum and permissions
node scripts/release-extension.mjs --publish # create the GitHub Release
```

The archive contains one top-level `unifetch-chromium-extension-vX.Y.Z/` directory whose root directly contains `manifest.json`. It excludes source files, `node_modules`, environment files, credentials, source maps, local caches, `opencode.jsonc` and research diagnostics. The publication script refuses a dirty tree, an unpushed commit, an existing tag/release, or a checksum that does not match `apps/web/src/config/extension-release.ts`.

## Architecture

- `@unifetch/core`: domain types, errors, URL validation, runtime/resolver contracts and narrow Zod API schema.
- `@unifetch/meta-resolver`: deterministic demo, Instagram references and acquisition profile, a separate Threads exact-post parser/normalizer, defensive GIF embed fallback, and shared defensive parsing. Transport belongs to runtime adapters.
- `@unifetch/runtime-web`: browser transport and browser-native downloads.
- `@unifetch/downloader`: explicit downloads, sequential for multiple assets.
- `@unifetch/share-target`: supported HTTP(S) link extraction, URL → text → title.
- `@unifetch/web`: Vue, Pinia, Vue Router, scoped CSS, shell-only PWA and configurable metadata client.
- `@unifetch/resolver-worker`: Cloudflare runtime and metadata-only `POST /api/resolve` API.
- `@unifetch/extension`: Chromium MV3 extension for authenticated Post, Carousel, Reel and explicit-id Story downloads inside the user's browser, distributed as a GitHub Releases ZIP.

PWA → one public Instagram or Threads URL → Resolver → platform-specific public metadata requests → normalized metadata and direct URLs → PWA → direct source/CDN asset request. See [architecture](docs/architecture.md).

## Extension (GitHub Releases, unpacked)

The extension is distributed as a versioned ZIP on [GitHub Releases](https://github.com/nasa314159/UniFetch/releases) and loaded manually as an unpacked Chromium extension. It is not published to the Chrome Web Store, requires Developer mode and does not update automatically. Downloading the ZIP does not install anything by itself.

End-user installation: [https://unifetch.pages.dev/extension](https://unifetch.pages.dev/extension). The guide covers downloading, extracting to a permanent folder, `chrome://extensions` → Developer mode → Load unpacked, selecting the folder that directly contains `manifest.json`, and opening Instagram in the same browser profile. Chromium loads the extension from that folder, so users must keep it.

For maintainers:

```sh
pnpm --filter @unifetch/extension build
# Local development only:
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist

pnpm package:extension
node scripts/release-extension.mjs --publish
```

The release publishes both `unifetch-chromium-extension-vX.Y.Z.zip` and its `.sha256` file. The release config lives in `apps/web/src/config/extension-release.ts`. If no verified release is configured, the installation page shows an accurate unavailable state instead of a dead download link.

Supported in the extension: authenticated Instagram Post, Carousel and Reel resolution/downloads, plus Story downloads when the URL contains an explicit Story media id (`/stories/<username>/<id>/`). Username-only Stories, Story video/audio/composite cases without an explicit id, Highlights and bulk Story enumeration are refused. Public Threads post media is resolved locally with `credentials: 'omit'`: static images, image carousels, native MP4, mixed carousels, tested Giphy GIFs and official `/share/<token>/` links. Threads profiles, `/t/` links, non-post share destinations, audio-only/private/login-required content and arbitrary enumeration are refused. Threads uses an optional `https://www.threads.com/*` host permission requested only from a Threads action; the required `declarativeNetRequestWithHostAccess` permission only adds temporary navigation headers and blocks nothing. The extension reads no cookies, exports no session data and contacts no UniFetch server. See [supported content](docs/supported-content.md). The Threads-capable build is an unpublished v0.3.0 release candidate; v0.2.0 remains the published ZIP.

## Privacy and hosting

Metadata resolution sends the chosen public URL to the configured Resolver. The Resolver sees it and the upstream response transiently. It uses only per-request upstream cookie/CSRF context, never user-provided Instagram credentials, and returns neither cookies nor raw responses. No application history, persistent storage, analytics or telemetry is added. Image/video bytes do not pass through the Worker.

The service worker caches only the application shell; it does not cache resolved metadata or media. The share route replaces its query before resolution. Host/provider logs and browser HTTP caches remain outside application control; operators must configure them appropriately. Open source makes the implementation auditable, but does not verify the behavior of a particular deployment. See [privacy](docs/privacy-model.md) and [threat model](docs/threat-model.md).

Serve `apps/web/dist` over HTTPS, routing `/` and `/share` to the shell. Configure `ALLOWED_ORIGINS` in `apps/resolver-worker/wrangler.jsonc` to the actual frontend origin(s); wildcard CORS and browser credentials are not used. Configure the frontend Resolver origin at build time. Production deployment requires a Cloudflare account and explicit deployment; see [Cloudflare deployment](docs/deployment.md) for Pages upload, public build configuration and production CORS. Worker observability and Wrangler metrics are disabled in the supplied configuration.

PWA installation and OS share-target support depend on browser/OS. GET share data may be observed by the static host before route replacement. `/share` is excluded from service-worker navigation fallback, so hosts relying on routing fallback need connectivity. Multiple native downloads can require browser permission.

## Milestones and limitations

M4A established offline parsing/normalization; M4B added the supplied acquisition profile. M4C integrated the direct pipeline. Public Image, Carousel and Reel probes each returned `BROWSER_RESTRICTION` in the tested browser environment. **M4D was intentionally skipped** because M4C had already established the runtime decision. M5 supplies remote metadata resolution while keeping media direct. M8 adds the local authenticated extension described above. M9A adds deterministic GitHub Releases packaging and the public `/extension` installation flow.

Web/PWA: public Instagram Post, Carousel and Reel; public Threads single posts, image carousels, native video and GIF-like animation. Official Threads `/share/<token>/` links are expanded once to one canonical public post before the same exact-post resolution runs. Threads profiles, discovery pages, `/t/` short links, non-post share pages, quoted/reposted substitution and private/login content are refused. The extension adds authenticated Instagram Post, Carousel, Reel and explicit-id Story support, plus public-only Threads post media (images, carousels, native video, tested Giphy GIFs and official share links) through the same shared Threads parser and downloader. Username-only Stories remain unsupported and fail closed. M8B–M8D Story page-state/current-id/visible-media experiments were moved to `research/m8b-m8d-instagram-story` and are not part of the stable release. No alternate endpoint discovery, crawling, bulk enumeration, private-account access, login, ZIP, audio extraction or video transcoding is implemented. Direct media preview/download remains subject to source/CDN browser restrictions; no proxy workaround exists.

The development-only `/dev/instagram-probe` form manually accepts exactly three public URLs, clears them on submission and shows only typed status or successful counts/types. It is excluded from production builds and stores/logs no inputs or outcomes.

MIT licensed. See [supported content](docs/supported-content.md).

M5–M5.5 local validation established successful metadata resolution for the tested public Instagram image post, carousel and Reel, direct image preview, direct image Blob download and Open original. The Cloudflare Resolver is the current Web/PWA compatibility runtime for metadata; media is fetched directly by the user’s browser/device. These tests do not establish support for all public content or live video downloads. No public identifiers or raw response payloads were retained in source, fixtures or documentation.

M5.4 local probes established successful public image, carousel and Reel metadata resolution and direct image preview. Direct downloads depend on browser/CDN cross-origin rules: still images read the direct source as a Blob when CORS permits and are normalized client-side to JPEG (white background for transparency). JPEG sources keep their original bytes; conversion failures retain the original format and report it. Videos are not transcoded. GIF sources keep their original animated GIF bytes; GIFs are never re-encoded to JPEG. Filenames use username, a short caption and the original media index. Open original is available separately and does not imply a saved file. Media bytes never pass through UniFetch Resolver; UniFetch does not relay media to bypass these rules.

T1C released the T1B Threads implementation to `main` and to the existing production Resolver and Pages project. Production smoke tests resolved a public Threads image, a native MP4 post, a mixed image/video carousel and a Giphy-attached GIF. Browser downloads produced a JPEG, an MP4, three ordered carousel assets (two MP4 and one JPEG) and a 17-frame animated GIF (259×200); media bytes were fetched directly from the source CDN, not through the Worker. GIF support remains limited to tested Giphy attachments and may expose only a reduced-height variant.

A follow-up incident fix makes `https://unifetch.pages.dev` the only supported Web origin: Cloudflare deployment aliases redirect there before the app starts, because they were never in the Resolver CORS allowlist and therefore failed with `NETWORK_ERROR` on both platforms. The PWA also auto-activates new service workers so a cached pre-release shell cannot pin resolution. A post-fix production-browser check resolved both a public Threads post and a public Instagram carousel.

T1D adds one-step Threads share-link expansion: the Worker requests only `https://www.threads.com/share/<token>/` with browser-navigation headers, never follows the redirect, validates that the single `Location` is an exact canonical Threads post on the official host, and then reuses the existing exact-post parser, publisher check and media normalizer. Canonical Threads links are unchanged, and malformed or ambiguous share links fail closed before any post request.

E1 adds Threads support to the Chromium extension without changing the published v0.2.0 release. The v0.3.0 candidate routes Instagram and Threads separately, reuses the existing Threads parser/share validator/GIF fallback/normalizer, sends every Threads metadata request with `credentials: 'omit'`, and uses a host-scoped `declarativeNetRequestWithHostAccess` rule only to present the navigation headers Threads requires for SSR metadata. E2 narrows that rule to non-tab extension requests (`tabIds: [-1]`) on `https://www.threads.com/` only, uses one shared rule lease for concurrent resolutions, removes the rule on success, failure, timeout and worker restart, and bounds the optional-permission prompt so the popup cannot wait forever. The rule never matches Instagram requests or ordinary Threads browsing tabs. E2 also accepts an official same-shortcode username redirect: a stale canonical handle is followed only when Threads itself redirects it, and the publisher is then validated against the final served handle; a different shortcode or a non-redirect publisher mismatch still fails closed. Threads filenames follow the same caption-first convention as Instagram: `<current-username>_<caption-snippet>[_NN].<ext>`, with no platform prefix. When the caption is empty, emoji-only or otherwise unusable, the stable shortcode is used instead (`<username>_<shortcode>[_NN].<ext>`). Threads host access remains an optional runtime permission requested only for Threads actions; Instagram keeps its existing required permission. The user's real-Chrome QA confirmed Threads image/video/carousel/GIF downloads, Instagram Post/Carousel/Reel/explicit-id Story and username-only Story fail-closed, the native Allow and **Deny** prompts, and the corrected Threads canonical/share URLs. The revised caption-based filename policy still needs the user's final real-Chrome confirmation, so v0.3.0 is **reviewed but not released**. Do not change the `/extension` download link until those manual gates pass and a release asset and checksum exist.

Instagram public Web metadata remains upstream-dependent. The Cloudflare Worker's anonymous bootstrap still succeeds, but Instagram can answer the fixed public metadata query with HTTP 401 `LOGIN_REQUIRED` from Cloudflare egress even when the same public request succeeds from a residential network. That is a genuine anonymous-access restriction, not a parser or CORS defect; the Web/PWA must not claim restored Instagram availability while it persists. Authenticated Instagram Post, Carousel, Reel and explicit-id Story downloads remain in the separate Chromium extension. These are tested samples, not universal platform guarantees. No live post IDs, media URLs or raw payloads are retained in the repository.
