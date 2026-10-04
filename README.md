# UniFetch

Save media you can already access. Direct media. Transparently.

UniFetch is an open-source Vue 3 web interface and installable PWA that processes one URL explicitly supplied by the user. Demo fixtures work locally. Public Instagram Post, Carousel and Reel metadata can be resolved by the open-source UniFetch Resolver within the tested public content scope. UniFetch does not proxy media files through its servers.

M5 adds a metadata-only Cloudflare Worker using the existing centralized Polaris profile. It requires no Instagram credentials or user account and stores no resolution history. Returned assets are direct source URLs, not relayed files. The profile is unstable; typed failures do not imply support for every public post. Live success is not guaranteed.

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
pnpm build
pnpm format:check
pnpm --filter @unifetch/web preview
```

Build typechecks the web app/packages, produces `apps/web/dist`, and typechecks/bundles the Worker through a Wrangler dry run. Tests use mocks and sanitized fixtures, never a Cloudflare account or live Instagram. Worker output and local Wrangler state are ignored.

## Architecture

- `@unifetch/core`: domain types, errors, URL validation, runtime/resolver contracts and narrow Zod API schema.
- `@unifetch/meta-resolver`: deterministic demo, Instagram references, existing single acquisition profile, defensive parser and normalizer. Transport belongs to runtime adapters.
- `@unifetch/runtime-web`: browser transport and browser-native downloads.
- `@unifetch/downloader`: explicit downloads, sequential for multiple assets.
- `@unifetch/share-target`: supported HTTP(S) link extraction, URL → text → title.
- `@unifetch/web`: Vue, Pinia, Vue Router, scoped CSS, shell-only PWA and configurable metadata client.
- `@unifetch/resolver-worker`: Cloudflare runtime and metadata-only `POST /api/resolve` API.

PWA → one public Instagram URL → Resolver → fixed Instagram bootstrap/metadata requests → normalized metadata and direct URLs → PWA → direct source/CDN asset request. See [architecture](docs/architecture.md).

## Privacy and hosting

Metadata resolution sends the chosen public URL to the configured Resolver. The Resolver sees it and the upstream response transiently. It uses only per-request upstream cookie/CSRF context, never user-provided Instagram credentials, and returns neither cookies nor raw responses. No application history, persistent storage, analytics or telemetry is added. Image/video bytes do not pass through the Worker.

The service worker caches only the application shell; it does not cache resolved metadata or media. The share route replaces its query before resolution. Host/provider logs and browser HTTP caches remain outside application control; operators must configure them appropriately. Open source makes the implementation auditable, but does not verify the behavior of a particular deployment. See [privacy](docs/privacy-model.md) and [threat model](docs/threat-model.md).

Serve `apps/web/dist` over HTTPS, routing `/` and `/share` to the shell. Configure `ALLOWED_ORIGINS` in `apps/resolver-worker/wrangler.jsonc` to the actual frontend origin(s); wildcard CORS and browser credentials are not used. Configure the frontend Resolver origin at build time. Production deployment requires a Cloudflare account and explicit deployment; see [Cloudflare deployment](docs/deployment.md) for Pages upload, public build configuration and production CORS. Worker observability and Wrangler metrics are disabled in the supplied configuration.

PWA installation and OS share-target support depend on browser/OS. GET share data may be observed by the static host before route replacement. `/share` is excluded from service-worker navigation fallback, so hosts relying on routing fallback need connectivity. Multiple native downloads can require browser permission.

## Milestones and limitations

M4A established offline parsing/normalization; M4B added the supplied acquisition profile. M4C integrated the direct pipeline. Public Image, Carousel and Reel probes each returned `BROWSER_RESTRICTION` in the tested browser environment. **M4D was intentionally skipped** because M4C had already established the runtime decision. M5 supplies remote metadata resolution while keeping media direct.

Stories are unsupported. Facebook and Threads are detected but planned only. ExtensionRuntime and NativeRuntime remain future options for fuller local execution; neither is implemented. No alternate endpoint discovery, crawling, bulk enumeration, private-account access, login, ZIP, audio extraction or video transcoding is implemented. Direct media preview/download remains subject to source/CDN browser restrictions; no proxy workaround exists.

The development-only `/dev/instagram-probe` form manually accepts exactly three public URLs, clears them on submission and shows only typed status or successful counts/types. It is excluded from production builds and stores/logs no inputs or outcomes.

MIT licensed. See [supported content](docs/supported-content.md).

M5–M5.5 local validation established successful metadata resolution for the tested public Instagram image post, carousel and Reel, direct image preview, direct image Blob download and Open original. The Cloudflare Resolver is the current Web/PWA compatibility runtime for metadata; media is fetched directly by the user’s browser/device. These tests do not establish support for all public content or live video downloads. No public identifiers or raw response payloads were retained in source, fixtures or documentation.

M5.4 local probes established successful public image, carousel and Reel metadata resolution and direct image preview. Direct downloads depend on browser/CDN cross-origin rules: still images read the direct source as a Blob when CORS permits and are normalized client-side to JPEG (white background for transparency). JPEG sources keep their original bytes; conversion failures retain the original format and report it. Videos are not transcoded. Filenames use username, a short caption and the original media index. Open original is available separately and does not imply a saved file. Media bytes never pass through UniFetch Resolver; UniFetch does not relay media to bypass these rules.
