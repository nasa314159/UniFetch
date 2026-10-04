# Privacy model

UniFetch's local-first goal keeps user choice explicit and media delivery direct. M5 does **not** claim all processing is local: one chosen public Instagram URL is sent to the configured open-source UniFetch Resolver for metadata. The Resolver receives upstream metadata, returns normalized data and direct source URLs, and does not proxy image/video bodies.

## Resolver trust boundary

Input is exactly one public content URL. Outbound requests are only the existing fixed Instagram bootstrap and Polaris metadata POST. Output is normalized post metadata/direct asset URLs and an accurate trace. The application never stores URL history, usernames, captions, cookies, response history or asset/download history.

No Instagram credentials or UniFetch account are required. User cookies, passwords, tokens and browser sessions cannot be submitted through the strict API schema; Cookie/Authorization headers are rejected. Upstream cookie/CSRF state may be obtained anonymously by the Worker, used in memory for one request and discarded. It is never returned to the browser, logged or persisted. No session snapshot escapes the runtime contract.

All upstream requests and API responses use no-store. There is no Worker Cache API, media buffering, persistent cache, KV, R2, D1, database or other storage binding. There are no analytics or telemetry. Supplied Wrangler metrics/Worker observability are disabled. Hosting providers may still observe requests through infrastructure logs; the application cannot certify a deployed provider's behavior. Operators must review provider logging policies. Open-source code allows auditing, not automatic verification of a particular hosted build.

## Trace semantics

Fixtures resolve locally without upstream requests. Worker metadata uses processedLocally=false, metadataResolverUsed=true, mediaProxyUsed=false and credentialsExported=false. Compatibility field remoteProxyUsed=true means a remote metadata intermediary was used. It never means media bytes were relayed. The UI distinguishes these stages and records origins only; direct preview/download requests happen afterward.

## Client storage and caching

Input/shared URLs, post results, authors, captions and asset references remain transient in memory. The app writes no localStorage/sessionStorage/IndexedDB content history. Permitted future preferences are limited to theme, language placeholder and onboarding/install dismissal. Explicit browser download actions intentionally save files on the user's device; the app cannot confirm filesystem writes.

The service worker caches only application-shell HTML, JS, CSS and icons. Its runtime cache rules are empty, demo media is excluded and user content never becomes an intentional cache entry. Fixed fictional fixtures are part of the shell bundle. There is no offline media archive. Source/CDN HTTP caching and browser history are outside application control.

## PWA limitations

Installation/share support depends on OS and browser. GET shares expose data to the initial navigation/host before the app replaces the URL. Replacement cannot erase data already observed by host logs or browser mechanisms. Configure hosting to avoid recording share queries. `/share` service-worker fallback is disabled; static-host routing may require connectivity.

Native multiple downloads may require permission. Direct media previews/saves can fail due to browser/CDN restrictions. No media proxy is introduced to bypass them. The dev-only probe clears inputs and retains only transient high-level statuses/counts/types, with no logs or storage; it is removed from production builds.

M4C direct probes for public Image, Carousel and Reel all returned BROWSER_RESTRICTION in the tested browser. M4D was intentionally skipped; M5 uses remote metadata resolution with the same profile.

M5–M5.5 local validation established successful metadata resolution for the tested public Instagram image post, carousel and Reel, direct image preview, direct image Blob download and Open original. The Cloudflare Resolver is the current Web/PWA compatibility runtime for metadata; media is fetched directly by the user’s browser/device. These tests do not establish support for all public content or live video downloads. No public identifiers or raw response payloads were retained in source, fixtures or documentation.

M5.4 established successful public metadata resolution and direct image preview in the tested browser. M5.5 downloads stay on the device: local fixtures use native anchors; remote assets use a credential-free, uncached browser fetch to the direct source and an in-memory Blob link, released after use. This requires a CORS-readable source response. A rejected fetch cannot reliably distinguish CORS from a network failure in JavaScript. There is no Worker download endpoint or media relay. Open original navigates to the source and never claims a saved download; cross-origin anchor download attributes may be ignored by browsers.

M5.5 image validation in the tested browser: the direct Blob fetch was readable and a nonempty JPEG was saved with the suggested filename. Open original loaded the source image. The cross-origin anchor attempt produced no observed download or navigation. These results are browser/source-specific; fallback remains available and no media traffic passed through the metadata Resolver. Reel download strategies were not tested because image behavior was conclusive. No live URLs, filenames or identifiers were recorded here.

Some Instagram content requires authenticated access. The current Web/PWA resolver intentionally does not receive user Instagram credentials or imported cookies. Explicit authentication markers and HTTP 401/403 produce `LOGIN_REQUIRED`; generic GraphQL execution failures produce `GRAPHQL_EXECUTION_ERROR`. A generic failure does not establish an age restriction. No distinct age-specific classification is enabled.
