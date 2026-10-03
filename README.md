# UniFetch

Save media you can already access. Locally. Transparently.

UniFetch is an open-source, local-first web interface that acts on one URL explicitly supplied by the user. This initial M0–M3 milestone is a polished static Vue application and installable PWA.

**This milestone uses deterministic Instagram fixtures while the live resolver is implemented separately. Live Instagram resolution and downloading are not implemented.** Arbitrary real Instagram links produce an explicit `UNSUPPORTED_CONTENT` error. No real Instagram network requests occur.

## Try the demo

Use the Image, Carousel, or Reel buttons, or paste:

- `https://www.instagram.com/p/unifetch-demo-image/`
- `https://www.instagram.com/p/unifetch-demo-carousel/`
- `https://www.instagram.com/reel/unifetch-demo-reel/`

The author is fictional. SVG artwork and MP4 clips were generated locally for this repository. Preview individual assets, select carousel items, download local files, and inspect the expandable Privacy section.

## Development

Prerequisites: Node.js 22 or newer and pnpm 10 (the package manager version is pinned in `package.json`).

```sh
pnpm install
pnpm dev
pnpm test
pnpm lint
pnpm build
pnpm --filter @unifetch/web preview
```

`pnpm build` typechecks the application and packages before building static files into `apps/web/dist`. `pnpm format` and `pnpm format:check` maintain formatting. No server, database, credentials, or environment secrets are required.

## Architecture

- `@unifetch/core`: domain types, typed errors, Zod input validation, URL normalization, runtime/resolver contracts and registry.
- `@unifetch/meta-resolver`: deterministic Instagram fixture resolver. It never calls global fetch or the runtime network adapter.
- `@unifetch/runtime-web`: a small browser runtime with credential-free, same-origin requests and local downloads.
- `@unifetch/downloader`: browser-native local downloads, sequential for multiple assets.
- `@unifetch/share-target`: HTTP(S) supported-link extraction with URL → text → title priority.
- `@unifetch/web`: Vue 3, Pinia state, Vue Router, scoped CSS and PWA shell.

Resolver contracts can later accept an extension or native runtime without being changed. Those runtimes are not implemented here. See [architecture](docs/architecture.md).

## Privacy principles

No media proxy, accounts, analytics, telemetry, tracking pixels, cookie export, or credential collection. URLs, posts, authors, captions, media references and downloads remain transient in memory. This version writes no preferences to local storage either.

The service worker precaches only the application shell, scripts, CSS and icons. Demo media is excluded; there are no runtime caching rules or offline media archives. Bundled scripts necessarily include the fixed fictional fixture metadata, never user-resolved data. The Privacy panel reports resolution requests separately from local preview/download requests.

## PWA and hosting

Serve `apps/web/dist` on HTTPS (localhost works for development). Configure static hosting to serve `index.html` for `/` and `/share`, while serving asset paths as files. The manifest registers a GET share target at `/share` with `title`, `text` and `url` fields. The route extracts a supported URL, replaces the visible route with `/`, then resolves normally. Sensitive share query data is not persisted by the app.

Install and share-target support depend on the browser and OS. Where supported, an Install app button appears. On other platforms use the browser's installation menu. Browser-native multiple downloads may require browser permission. Share requests can reach the static host before the app scrubs them, so configure hosting logs appropriately; this app cannot control browser history, HTTP caches or hosting logs. `/share` is excluded from service-worker navigation fallback. GET shares therefore require connectivity on hosts that rely on a routing fallback.

## Limitations and roadmap

- Instagram Post, Carousel, Reel: fixture/demo only.
- Stories: not supported.
- Facebook and Threads: detected; planned, no resolver.
- Future: separately implemented live Instagram resolver and extension/native runtime adapters, subject to platform access controls and the same trust boundaries.
- No crawling, bulk enumeration, authentication bypass, ZIP creation, audio extraction or transcoding.

Only an explicit resolve/share action processes a URL. Only an explicit download action saves media. Review [privacy](docs/privacy-model.md), [threat model](docs/threat-model.md) and [supported content](docs/supported-content.md).

MIT licensed.
