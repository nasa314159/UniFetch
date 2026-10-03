# UniFetch

Save media you can already access. Locally. Transparently.

UniFetch is an open-source, local-first web interface that acts on one URL explicitly supplied by the user. It is a static Vue application and installable PWA with a deterministic demo and a layered Instagram resolution pipeline.

**M4C wires live Instagram URL handling into acquisition → parser → normalizer → result, while keeping deterministic demo fixtures separate.** Ordinary WebRuntime cannot access Instagram’s cross-origin session context from the UniFetch origin and returns `BROWSER_RESTRICTION` before bootstrap. Real-browser checks confirmed this restriction; one user-supplied public image post, one public carousel and one public Reel each returned `BROWSER_RESTRICTION`. None succeeded, and no live media download was tested. Live downloading is not claimed to work. There is no remote proxy fallback.

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
- `@unifetch/meta-resolver`: separate fixture and live paths; content references, one supplied unstable acquisition profile, defensive parser and normalizer. Only the runtime owns transport.
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

## Developer-only manual probe

With `pnpm dev`, open `/dev/instagram-probe`. Supply exactly one public image-post URL, one public carousel URL and one public Reel URL, then explicitly run the three probes. Inputs clear on submission and remain transient; the harness displays only typed status, or successful kind/count/types. Nothing is logged or persisted. The route and harness are removed from production builds. Do not add real identifiers or captured payloads to source, tests, docs or fixtures.

## Limitations and roadmap

- Instagram Post, Carousel, Reel: demo is reliable; live pipeline accepts `/p/`, `/reel/` and `/reels/` paths, but WebRuntime is restricted by origin/session policy.
- Stories: not supported.
- Facebook and Threads: detected; planned, no resolver.
- Future: ExtensionRuntime or NativeRuntime may provide broader local capabilities, subject to platform access controls and the same trust boundaries. Neither is implemented.
- Downloads reuse the existing browser-native flow. The current downloader rejects non-local demo assets with `BROWSER_RESTRICTION`; no successful live media download has been validated.
- No crawling, bulk enumeration, authentication bypass, ZIP creation, audio extraction or transcoding.

Only an explicit resolve/share action processes a URL. Only an explicit download action saves media. Review [privacy](docs/privacy-model.md), [threat model](docs/threat-model.md) and [supported content](docs/supported-content.md).

MIT licensed.
