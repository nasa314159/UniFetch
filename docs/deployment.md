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
| Released `main`            | `c92d832` (fast-forward from `feat/threads-public-media`; branch kept) |
| Resolver deployment        | `dcabbaeb-a904-4e9e-ab94-f8b6a80d7270`                                 |
| Resolver version           | `be1a078c-f101-4d3f-8e5b-270e153f1631`                                 |
| Resolver URL               | `https://unifetch-resolver.cernmeow.workers.dev`                       |
| Resolver `ALLOWED_ORIGINS` | `https://unifetch.pages.dev` only                                      |
| Pages deployment           | `75dcedd7-c190-45af-b394-0e3b997b8cb4`                                 |
| Pages immutable URL        | `https://75dcedd7.unifetch.pages.dev`                                  |
| Pages production URL       | `https://unifetch.pages.dev`                                           |
| Extension                  | unchanged `v0.2.0`; ZIP and SHA-256 rechecked from GitHub Releases     |

The previous Worker deployment for rollback reference was `631278e6-c02d-43fd-86ec-e5948ab3114c` (version `0a8e5ccb-084d-49af-be69-cd1a91dcb78c`). The previous Pages deployment was `efbf4799-5b8d-4090-8d54-19f6454769ac`. Do not guess a rollback target; confirm it in Cloudflare first.

T1C production verification passed for Threads single image, native MP4 (playable preview and download), mixed video/video/image carousel (ordered downloads) and a Giphy GIF (17-frame animated GIF preserved; reduced 259×200 variant). Owner mismatch, `/t/`, profile/search/share URLs and unavailable posts failed closed. CORS preflight allowed only `https://unifetch.pages.dev`; no `Access-Control-Allow-Credentials` was present; media bytes were fetched directly from Meta/Giphy CDNs. Sampled public Instagram URLs returned `LOGIN_REQUIRED` from upstream during T1C, so live Instagram resolution is not verified in this release even though its code path is unchanged and its automated tests pass.

## Resolver

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

Threads SSR was confirmed through the deployed Cloudflare edge during T1C: the production Worker returned normalized metadata for bounded public image, native-video, mixed-carousel and Giphy-GIF samples. If a future deployment returns the JavaScript shell instead of SSR metadata, keep the affected capability disabled and do not add a proxy or weaken parser requirements. Recheck one public Threads image, carousel, native video and GIF post, plus canonical owner/code rejection and `/t/` rejection. Do not log or retain live post IDs, media URLs, authors or captions.

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

The release contains the ZIP and a matching `.sha256` asset.

The packaging script refuses a dirty tree (only untracked `opencode.jsonc` and ignored `artifacts/` are tolerated), mismatched manifest/package versions, missing manifest-referenced files, unexpected permissions, source/development files, secret-like content, or an archive that does not round-trip with valid CRCs. The release script refuses to overwrite an existing tag or release and verifies that a fresh deterministic package matches the website checksum.

The archive extracts to one top-level `unifetch-chromium-extension-vX.Y.Z/` directory containing `manifest.json`, `background.js`, `popup.html`, `popup.js` and any other manifest-referenced runtime files. There is no nested `dist/` directory.

After publication, download the asset from GitHub, verify its SHA-256, and update `apps/web/src/config/extension-release.ts` if the published URL or checksum differs. Then rebuild/redeploy Pages so `/extension` links to the verified asset. Do not publish the web update before the release asset exists.

For local development only:

```sh
pnpm --filter @unifetch/extension build
# chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

Reload the extension after every rebuild. The popup checks the background protocol marker and disables actions until both halves report the same build. The extension never contacts the Resolver origin and never needs a Worker variable.
