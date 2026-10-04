# Cloudflare deployment

Deploy the static Web/PWA on Cloudflare Pages and the metadata Resolver as a separate Cloudflare Worker. Temporary `pages.dev` and `workers.dev` HTTPS domains are sufficient. Custom domains are optional future work; no DNS changes are required.

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
VITE_UNIFETCH_RESOLVER_URL=https://YOUR-RESOLVER.workers.dev pnpm --filter @unifetch/web build
```

In the authenticated Cloudflare dashboard choose Pages, Direct Upload, and upload the **contents** of `apps/web/dist` as a folder or ZIP. The archive root must contain `index.html`, not an enclosing `dist` directory. Direct Upload serves prebuilt files, so dashboard runtime variables cannot change an already-built Vite bundle; rebuild before uploading whenever the Resolver origin changes. No repository integration or new API token is required for dashboard upload.

Pages serves the SPA fallback when no top-level `404.html` exists. Verify `/` and `/share`, manifest, icons and service-worker assets after deployment. Do not add Pages Functions, media relay routes or analytics.

## Production validation

Check Worker OPTIONS preflight from the exact Pages origin, malformed/unsupported input, and the inaccessible media/development routes. Responses must remain `Cache-Control: no-store` with no credential-bearing CORS headers.

In a production browser check all three fixtures, explicitly supplied public Instagram content, direct preview, Blob download, Open original and the privacy panel. Check share query replacement, service-worker registration and the GET `share_target` manifest entry. Full mobile share-sheet testing remains human device QA.

Use live content only transiently; never record its page URL, media URL, payload, author or caption in project files or diagnostic logs. Application storage and service-worker caches must not retain resolved content. Browser history, source HTTP caches and provider infrastructure logs remain outside app control.

Metadata goes through the Resolver Worker. Media previews/downloads go directly from the user's browser/device to the source/CDN. The Worker never relays media to work around CORS. Public access and download success depend on the source and browser; tested samples do not establish universal support.
