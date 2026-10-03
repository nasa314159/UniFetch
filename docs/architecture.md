# Architecture

The pnpm workspace contains a static Vue PWA and a separate metadata-only Cloudflare Worker. Cloudflare-specific code stays in `apps/resolver-worker`; core and resolver packages do not depend on Wrangler.

## Package boundaries

`core` owns domain types, typed errors, exact supported-host validation/normalization, runtime/resolver contracts and the narrow Zod Resolver API schema. Userinfo and custom ports are rejected. Known tracking parameters/fragments are removed; unknown functional query parameters are retained by general normalization.

`meta-resolver` owns deterministic fixtures, InstagramContentRef parsing, `POLARIS_POST_ROOT_PROFILE_V1`, request construction, acquisition contract, defensive structured-response parser and normalizer. The runtime owns network I/O; parsers and resolvers do not use global fetch. `/reels/` normalizes to `/reel/`. Media kind comes from the response. Sanitized raw fixtures use only synthetic URLs, independently of UI demo fixtures.

`runtime-web` owns browser requests and downloads. Its M4C origin-session implementation remains available through existing contracts/tests, but the production web client does not attempt direct cross-origin Instagram acquisition. ExtensionRuntime and NativeRuntime remain future options for fuller local execution through the same contracts; neither is implemented.

`downloader` handles explicit browser-native downloads, sequential for multiple selections. Media bytes never go through the metadata API. Source/browser restrictions may prevent a save; no ZIP or transcoding exists.

`share-target` selects one supported HTTP(S) URL from URL, text, then title. `/share` extracts query fields and replaces the visible route with `/` before calling the same transient Pinia store used by manual Resolve.

`web` owns IDLE/RESOLVING/RESOLVED/ERROR states, previews, selection, source labels and privacy details. Exact fixture paths resolve locally. Other supported Instagram paths use only the configured Resolver API, with credentials omitted, no-store and no redirects. API responses are schema-validated and matched to the requested canonical URL. Missing configuration is a typed error, never direct-network fallback.

## Metadata flow

```text
PWA -- explicit public Instagram URL --> UniFetch Resolver
    -- fixed bootstrap + metadata POST --> Instagram
    <-- structured metadata -- Instagram
PWA <-- normalized metadata + direct asset URLs -- UniFetch Resolver
PWA -- direct asset request --> Instagram / source CDN
```

The Worker accepts POST/OPTIONS at `/api/resolve` only. It limits the JSON body to 4096 bytes, uses a strict single-url schema, accepts supported HTTPS Instagram content paths, and rejects client credentials, custom destinations and query-bearing API requests. Mobile Instagram host input supports posts; canonical/www hosts support posts, reel and reels. It parses the reference rather than fetching the raw input URL.

`CloudflareInstagramAcquisitionAdapter` reuses the supplied Polaris adapter. `CloudflareMetadataRuntime` permits only the profile's root bootstrap and exact metadata endpoint. Redirects are not followed; requests use no-store and 10-second timeouts. Bootstrap body is cancelled; metadata is bounded to 1 MiB. Cookie/CSRF context lives inside a per-request runtime session closure, permits one profile POST and is discarded afterward. No cookie or token is exposed in the session contract.

The existing M4A parser/normalizer selects direct media candidates and preserves carousel order. Malformed children fail rather than silently reorder. Missing structure means PARSER_OUTDATED; unavailable/auth/rate/network errors retain typed categories. The Worker validates a narrow success response (at most 100 assets) before sending it, without raw JSON, headers, cookies or stacks. Only normalized post, trace, response-derived kind and transport identity are returned.

API output includes Cache-Control: no-store, Pragma: no-cache and explicit configurable CORS without Access-Control-Allow-Credentials. There are no media routes, caches, bindings, persistence or background processing. Wrangler builds locally with a dry run; deployment is separate.

## Trace and UI

Fixture results remain processedLocally=true, remoteProxyUsed=false, credentialsExported=false with no resolution network requests. Worker results use processedLocally=false, metadataResolverUsed=true, mediaProxyUsed=false, credentialsExported=false. Compatibility field remoteProxyUsed=true denotes a remote **metadata intermediary**, not a media relay. The web client adds its Resolver origin to origin-only upstream metadata records. These records describe resolution, not subsequent direct media previews/downloads.

Worker results show “Resolution source: UniFetch Resolver” and separate resolution/media privacy statements. Fixtures show “Demo fixture” and their accurate local trace.

## Historical decision

M4C direct WebRuntime probes for public Image, Carousel and Reel each returned BROWSER_RESTRICTION in the tested environment, before cross-origin bootstrap. No live success/download was established by those probes. M4D was intentionally skipped because this already established the runtime decision. M5 changes normal production transport to the metadata Resolver, without adding an alternate Instagram profile.

## PWA

The manifest uses standalone display and a GET `/share` target. Service-worker precaching includes only shell HTML, JS, CSS and icons. Demo media is excluded, runtime caching is empty, and share/demo navigation fallback is denied. Fixed fictional demo metadata is compiled into JS. No resolved URL, metadata or media is intentionally cached. Hosting and browser caches are separate operator/browser responsibilities.

M5–M5.5 local validation established successful metadata resolution for the tested public Instagram image post, carousel and Reel, direct image preview, direct image Blob download and Open original. The Cloudflare Resolver is the current Web/PWA compatibility runtime for metadata; media is fetched directly by the user’s browser/device. These tests do not establish support for all public content or live video downloads. No public identifiers or raw response payloads were retained in source, fixtures or documentation.
