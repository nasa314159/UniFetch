# Cloudflare deployment

Deploy the static Web/PWA on Cloudflare Pages and the metadata Resolver as a separate Cloudflare Worker. Temporary `pages.dev` and `workers.dev` HTTPS domains are sufficient. Custom domains are optional future work; no DNS changes are required.

## Verified production target

| Component | Target                                          | Type                |
| --------- | ----------------------------------------------- | ------------------- |
| Web/PWA   | Pages project `unifetch` → `unifetch.pages.dev` | Direct Upload       |
| Resolver  | Worker `unifetch-resolver`                      | Wrangler deployment |
| Extension | GitHub Release `extension-vX.Y.Z`               | Manual ZIP asset    |

The Pages project is not connected to a Git provider; production is published from a locally built `apps/web/dist`. Do not touch other Pages projects (`linktree`, `114-514-org`), custom domains, DNS or billing. The extension is not deployed to Cloudflare.

## T1C Threads release checkpoint (2026-10-24)

| Item                       | Value                                                                  |
| -------------------------- | ---------------------------------------------------------------------- |
| Base `main`                | `6bc2ed9`                                                              |
| T1C release code           | `c92d832` (fast-forward from `feat/threads-public-media`; branch kept) |
| Incident fix code          | `4df40a1`                                                              |
| Resolver deployment        | `98074334-7a82-4a62-bc50-613b71aaffab`                                 |
| Resolver version           | `32501ed7-03c9-4dc2-970a-1c9199c5bb18`                                 |
| Resolver URL               | `https://unifetch-resolver.cernmeow.workers.dev`                       |
| Resolver `ALLOWED_ORIGINS` | `https://unifetch.pages.dev` only                                      |
| Pages deployment           | `70db1fd8-de68-48f1-9377-2cc9485c946e`                                 |
| Pages deployment alias     | `https://70db1fd8.unifetch.pages.dev` (redirects to canonical)         |
| Pages production URL       | `https://unifetch.pages.dev`                                           |
| Extension                  | unchanged `v0.2.0`; ZIP and SHA-256 rechecked from GitHub Releases     |

The Worker deployment before the incident fix was `dcabbaeb-a904-4e9e-ab94-f8b6a80d7270` (version `be1a078c-f101-4d3f-8e5b-270e153f1631`). The T1C Pages deployment was `75dcedd7-c190-45af-b394-0e3b997b8cb4`; Cloudflare stopped serving that deployment alias after the next deployment. Do not guess a rollback target; confirm it in Cloudflare first.

T1C production verification passed for Threads single image, native MP4 (playable preview and download), mixed video/video/image carousel (ordered downloads) and a Giphy GIF (17-frame animated GIF preserved; reduced 259×200 variant). Owner mismatch, `/t/`, profile/search/share URLs and unavailable posts failed closed. CORS preflight allowed only `https://unifetch.pages.dev`; no `Access-Control-Allow-Credentials` was present; media bytes were fetched directly from Meta/Giphy CDNs.

### Production resolve incident and fix

The T1C report also published the deployment alias `https://75dcedd7.unifetch.pages.dev`. Opening that alias reproduces a Resolve failure on **both** platforms: the frontend origin is not in `ALLOWED_ORIGINS`, so the browser blocks the response and the UI reports `NETWORK_ERROR` before any media preview. The canonical `https://unifetch.pages.dev` origin was healthy throughout. Deployment aliases are ephemeral and are no longer user-facing URLs.

The incident fix has two parts:

1. The Web app redirects eight-character hexadecimal Pages deployment aliases to `https://unifetch.pages.dev`, preserving path, query and hash, before mounting the app. `/share?url=…` therefore still works from an alias by redirecting and then scrubbing the query on the canonical origin.
2. The PWA now uses `registerType: 'autoUpdate'` with Workbox `skipWaiting`/`clientsClaim`, so a new service worker replaces an older cached shell automatically instead of waiting behind an update prompt that the app never showed. A client that already has an old worker may need one reload before the new shell is used; the next navigation is served from the new cache.

A follow-up production-browser check on the canonical origin resolved both a public Threads post and a public Instagram carousel (eight metadata assets). Live Instagram availability remains upstream-dependent; a `LOGIN_REQUIRED` response is a source restriction, not a CORS or schema failure.

## T1D Threads share expansion checkpoint (2026-10-24)

| Item                       | Value                                  |
| -------------------------- | -------------------------------------- |
| T1D code commit            | `8b9ac70`                              |
| Resolver deployment        | `70e2ea05-8271-4f56-a18e-341abd47b9d0` |
| Resolver version           | `14fc412d-9971-491a-a226-76f53d0d556d` |
| Pages deployment           | `4d5dbc66-05ea-4437-8e3c-59fc54bd58d7` |
| Pages deployment alias     | `https://4d5dbc66.unifetch.pages.dev`  |
| Pages production URL       | `https://unifetch.pages.dev`           |
| Resolver `ALLOWED_ORIGINS` | `https://unifetch.pages.dev` only      |

T1D adds official Threads `/share/<token>/` expansion. The Worker sends one `GET` to `https://www.threads.com/share/<token>/` with browser-navigation headers and `redirect: 'manual'`; Threads answers `302` with a canonical post `Location` only when those headers are present. The Worker does not follow the redirect: it accepts exactly one HTTPS same-origin `/@<username>/post/<shortcode>/` destination, discards the opaque `xmt` query, and then reuses the existing exact-post parser, publisher validation, GIF embed fallback and normalizer. A malformed token fails before any request; a token that returns the generic `200` shell, a login redirect, a cross-origin destination, or a non-post path fails closed with a typed error.

Production checks for T1D resolved two distinct public share links to their canonical posts, re-resolved a canonical permalink unchanged, rejected a malformed token with `INVALID_URL`, and returned `UNSUPPORTED_CONTENT` for a share link whose post has no downloadable media. The browser check on `https://unifetch.pages.dev` resolved the supplied share URL and a canonical permalink, displayed the correct post and preview dimensions, and showed typed errors for malformed and no-media share links.

Instagram is unchanged and remains **not restored**: a production-edge diagnostic showed the anonymous bootstrap returning `200` with CSRF, then the fixed public metadata query returning HTTP `401` JSON classified as `LOGIN_REQUIRED`. The same public request succeeds from a residential network. That is an upstream anonymous-access restriction for Cloudflare egress, not a parser, CORS, service-worker or deployment defect. Do not weaken identity checks or add authenticated/session-based acquisition to the Web path.

## E1/E2 Threads local-extension candidate (2026-10-24)

E1 extends the Chromium extension on branch `feat/threads-local-extension`. E2 reviewed and validated the candidate. It is **not merged and not published**. The existing `extension-v0.2.0` GitHub Release and ZIP remain the rollback baseline and must not be modified.

- Extension source/version: `0.3.0` candidate (`apps/extension/manifest.json`, `apps/extension/package.json`).
- Website `apps/web/src/config/extension-release.ts`: intentionally still points at the verified v0.2.0 asset.
- New required permission: `declarativeNetRequestWithHostAccess`, used only for a temporary navigation-header rule. E2 restricted it to non-tab extension requests (`tabIds: [-1]`) for `xmlhttprequest` on the exact `https://www.threads.com/` origin. It blocks nothing and is removed after acquisition or on worker restart.
- New optional host permission: `https://www.threads.com/*`, requested only from a Threads Resolve/Download action. Instagram remains on the existing required `https://www.instagram.com/*` grant.
- Threads acquisitions use `credentials: 'omit'`; the browser session is not attached.
- E2A fixed three release-gate defects: the session rule previously matched ordinary Threads tabs; each resolution created its own rule lease; and an unanswered optional-permission prompt could hang the popup. The rule now has a hard tab/origin/type boundary, all resolutions share one serialized lease, and the prompt is bounded at 60 seconds.
- Packaging is unchanged (`pnpm package:extension` then `scripts/release-extension.mjs`). Do not run `--publish` until the manual gates below pass and the website configuration has been updated in the release commit.

E2B ran the production optional-permission build in real headed Chrome for Testing 156. Threads access was granted through Chrome's extension Site access control (not the native first-run prompt), and the following actual files were saved: a public image, an ordered four-image carousel, native MP4, official share-link image carousel and video, and a 47-frame animated Giphy GIF. The header rule was absent after every acquisition. A tabbed Threads fetch kept `Sec-Fetch-Mode: cors` while an extension fetch received `navigate`; an Instagram workflow did not request Threads access. Removing the optional grant made the background return `PERMISSION_REQUIRED` and install no rule.

The user's subsequent real-Chrome QA passed Threads image/video/carousel/GIF downloads, Instagram authenticated Post/Carousel/Reel/explicit-id Story, username-only Story fail-closed, and the native Threads **Allow** prompt. It also exposed a canonical-post failure: the supplied URL used a stale username that Threads 301-redirects to the same shortcode under its current handle. The post is a single image, not a mixed carousel. E2B now permits only an official same-shortcode username redirect, validates the SSR publisher against the final URL, and uses the final handle in `canonicalUrl`, `author` and the new Threads filenames (`threads_<current-username>_<shortcode>[_NN].<ext>`). Two real mixed image/video carousels (9 and 15 items) resolved and downloaded in order.

**Still pending, and therefore blocking publication:**

1. Physically deny the native Threads optional-permission prompt in real Chrome (Allow already passed).
2. Have the user retest the corrected canonical and share URLs for the previously failing Threads post in the production build; headless verification passed both but is not a substitute for the user's real-Chrome retest.

Regression coverage uses synthetic fixtures; do not add the corrected post's live identifiers to the repository.

Do not publish from the feature branch: `scripts/release-extension.mjs` accepts only `main` or `release/instagram-stable`.

Use the existing authenticated Wrangler installation. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
pnpm format:check
```

For the initial deployment, allow no browser origins until the Pages hostname is known:

```sh
cd apps/resolver-worker
WRANGLER_SEND_METRICS=false pnpm exec wrangler deploy --var ALLOWED_ORIGINS:''
```

Record the generated HTTPS Resolver origin. After Pages assigns its production hostname, redeploy with exactly that frontend origin:

```sh
WRANGLER_SEND_METRICS=false pnpm exec wrangler deploy --var ALLOWED_ORIGINS:https://YOUR-PROJECT.pages.dev
```

Always supply the production CORS override: the checked-in default is for localhost development. Do not grant wildcard CORS or browser credentials. Use the normal `src/index.ts` entry from `wrangler.jsonc`, never the local diagnostic entry. Worker observability and Wrangler metrics are disabled. No storage bindings, secrets, Instagram credentials or media routes are needed.

## Static Web/PWA

`VITE_UNIFETCH_RESOLVER_URL` is a public HTTPS origin, without a path, query or credentials. It is baked into the static build; there is no frontend secret. Keep deployment-specific values outside core/resolver packages and source control.

For Pages Git builds, set this public variable in Cloudflare deployment settings, use `pnpm install --frozen-lockfile && pnpm --filter @unifetch/web build`, and publish `apps/web/dist` from the repository root.

For Pages Direct Upload, build locally with the public deployment value:

```sh
VITE_UNIFETCH_RESOLVER_URL=https://unifetch-resolver.cernmeow.workers.dev pnpm --filter @unifetch/web build
WRANGLER_SEND_METRICS=false npx wrangler@4 pages deploy apps/web/dist --project-name unifetch
```

The checked-in Resolver origin is the existing production Worker. Always pass `--project-name unifetch`; never omit it when multiple Pages projects exist in the account.

In the authenticated Cloudflare dashboard choose Pages, Direct Upload, and upload the **contents** of `apps/web/dist` as a folder or ZIP. The archive root must contain `index.html`, not an enclosing `dist` directory. Direct Upload serves prebuilt files, so dashboard runtime variables cannot change an already-built Vite bundle; rebuild before uploading whenever the Resolver origin changes. No repository integration or new API token is required for dashboard upload.

Pages serves the SPA fallback when no top-level `404.html` exists. Verify `/`, `/share` and `/extension`, manifest, icons and service-worker assets after deployment. The `/extension` page is shell-only: it links to a published GitHub Release asset and does not call the GitHub API at runtime. Do not add Pages Functions, media relay routes or analytics.

## Production validation

Check Worker OPTIONS preflight from the exact Pages origin, malformed/unsupported input, and the inaccessible media/development routes. Responses must remain `Cache-Control: no-store` with no credential-bearing CORS headers.

Threads SSR was confirmed through the deployed Cloudflare edge during T1C: the production Worker returned normalized metadata for bounded public image, native-video, mixed-carousel and Giphy-GIF samples. If a future deployment returns the JavaScript shell instead of SSR metadata, keep the affected capability disabled and do not add a proxy or weaken parser requirements. Recheck one public Threads image, carousel, native video and GIF post, plus canonical owner/code rejection and `/t/` rejection.

For share links, check one valid official `/share/<token>/` URL, one canonical permalink, one malformed token and one share link whose post has no downloadable media. Confirm the Worker requests the share URL once and then the canonical post URL, never follows the share redirect, and never returns the token, raw `Location`, upstream body or a share URL in `post.canonicalUrl`. Do not log or retain live post IDs, media URLs, authors or captions.

In a production browser check all three fixtures, explicitly supplied public Instagram content, direct preview, Blob download, Open original and the privacy panel. For Threads, check a public image, video and GIF, including GIF animation preservation and the absence of a static-preview substitution. Check share query replacement, service-worker registration and the GET `share_target` manifest entry. Full mobile share-sheet testing remains human device QA.

Use live content only transiently; never record its page URL, media URL, payload, author or caption in project files or diagnostic logs. Application storage and service-worker caches must not retain resolved content. Browser history, source HTTP caches and provider infrastructure logs remain outside app control.

Metadata goes through the Resolver Worker. Media previews/downloads go directly from the user's browser/device to the source/CDN. The Worker never relays media to work around CORS. Public access and download success depend on the source and browser; tested samples do not establish universal support.

## Extension

The Chromium extension is not a Cloudflare artifact. It is distributed as a versioned GitHub Releases ZIP and loaded by users as an unpacked extension. It is not in the Chrome Web Store and does not auto-update.

Maintainer release procedure, from a clean `main` or `release/instagram-stable` checkout:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
pnpm format:check
git diff --check

# 1. Build, audit and deterministically package from the committed tree.
pnpm package:extension
# artifacts/unifetch-chromium-extension-vX.Y.Z.zip
# artifacts/unifetch-chromium-extension-vX.Y.Z.zip.sha256
# artifacts/extension-release.json

# 2. Record the SHA-256 and size in
#    apps/web/src/config/extension-release.ts, then commit that change.

# 3. Verify the tag, commit, checksum and download URL.
node scripts/release-extension.mjs

# 4. Publish the GitHub Release at the pushed commit.
node scripts/release-extension.mjs --publish
```

The release contains the ZIP and a matching `.sha256` asset. For v0.3.0, the release notes must mention public-only local Threads support, the optional `threads.com` host permission and the host-scoped `declarativeNetRequestWithHostAccess` permission. Do not publish from the feature branch: `scripts/release-extension.mjs` accepts only `main` or `release/instagram-stable`.

The packaging script refuses a dirty tree (only untracked `opencode.jsonc` and ignored `artifacts/` are tolerated), mismatched manifest/package versions, missing manifest-referenced files, unexpected permissions, source/development files, secret-like content, or an archive that does not round-trip with valid CRCs. The release script refuses to overwrite an existing tag or release and verifies that a fresh deterministic package matches the website checksum.

The archive extracts to one top-level `unifetch-chromium-extension-vX.Y.Z/` directory containing `manifest.json`, `background.js`, `popup.html`, `popup.js` and any other manifest-referenced runtime files. There is no nested `dist/` directory.

After publication, download the asset from GitHub, verify its SHA-256, and update `apps/web/src/config/extension-release.ts` if the published URL or checksum differs. Then rebuild/redeploy Pages so `/extension` links to the verified asset. Do not publish the web update before the release asset exists.

For local development only:

```sh
pnpm --filter @unifetch/extension build
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

Reload the extension after every rebuild. The popup checks the background protocol marker and disables actions until both halves report the same build. The extension never contacts the Resolver origin and never needs a Worker variable.
