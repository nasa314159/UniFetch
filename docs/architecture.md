# Architecture

The pnpm workspace contains a static Vue PWA and a separate metadata-only Cloudflare Worker. Cloudflare-specific code stays in `apps/resolver-worker`; core and resolver packages do not depend on Wrangler.

## Package boundaries

`core` owns domain types, typed errors, exact supported-host validation/normalization, runtime/resolver contracts and the narrow Zod Resolver API schema. Userinfo and custom ports are rejected. Known tracking parameters/fragments are removed; unknown functional query parameters are retained by general normalization.

`meta-resolver` owns deterministic fixtures, InstagramContentRef parsing, `POLARIS_POST_ROOT_PROFILE_V1`, request construction, acquisition contract, defensive structured-response parser and normalizer. It also owns a separate Threads exact-post content reference parser, SSR/Relay parser, embed-GIF fallback parser and normalizer; Threads does not reuse Instagram’s request profile. The runtime owns network I/O; parsers and resolvers do not use global fetch. `/reels/` normalizes to `/reel/`. Media kind comes from the response. Sanitized raw fixtures use only synthetic URLs, independently of UI demo fixtures.

`runtime-web` owns browser requests and downloads. Its M4C origin-session implementation remains available through existing contracts/tests, but the production web client does not attempt direct cross-origin Instagram acquisition. The separate `apps/extension` MV3 build provides authenticated local execution; `ExtensionRuntime`/`NativeRuntime` package slots remain future options. The Web/PWA never imports the extension and does not receive its session context.

`downloader` handles explicit browser-native downloads, sequential for multiple selections. Media bytes never go through the metadata API. Source/browser restrictions may prevent a save; no ZIP or transcoding exists.

`share-target` selects one supported HTTP(S) URL from URL, text, then title. `/share` extracts query fields and replaces the visible route with `/` before calling the same transient Pinia store used by manual Resolve.

`web` owns IDLE/RESOLVING/RESOLVED/ERROR states, previews, selection, source labels and privacy details. Exact Instagram fixture paths resolve locally. Other supported Instagram and Threads paths use only the configured Resolver API, with credentials omitted, no-store and no redirects. API responses are schema-validated and matched to the requested canonical URL and platform. Missing configuration is a typed error, never direct-network fallback.

## Metadata flow

```text
PWA -- explicit public Instagram URL --> UniFetch Resolver
    -- fixed bootstrap + metadata POST --> Instagram
    <-- structured metadata -- Instagram
PWA -- explicit public Threads URL --> UniFetch Resolver
    -- one canonical SSR page, plus exact-post embed only for GIF --> Threads
    <-- structured metadata -- Threads
PWA <-- normalized metadata + direct asset URLs -- UniFetch Resolver
PWA -- direct asset request --> platform / source CDN
```

The Worker accepts POST/OPTIONS at `/api/resolve` only. It limits the JSON body to 4096 bytes, uses a strict single-url schema, accepts supported HTTPS Instagram and Threads content paths, and rejects client credentials, custom destinations and query-bearing API requests. Mobile Instagram host input supports posts; canonical/www hosts support posts, reel and reels. Threads accepts one canonical `@user/post/<shortcode>` permalink (plus verified aliases/slug/media forms) or one official `/share/<token>/` link, and rejects profiles, `/t/`, non-post share paths, search and unrelated paths. It parses the reference rather than fetching the raw input URL. A share token is expanded by one bounded, redirect-manual request to the constructed official share URL; only an exact same-origin canonical post `Location` is accepted, then the normal exact-post path runs. There is no general-purpose URL expansion or arbitrary redirect following.

`CloudflareInstagramAcquisitionAdapter` reuses the supplied Polaris adapter. `CloudflareMetadataRuntime` permits only the profile's root bootstrap and exact metadata endpoint. Redirects are not followed; requests use no-store and 10-second timeouts. Bootstrap body is cancelled; metadata is bounded to 1 MiB. Cookie/CSRF context lives inside a per-request runtime session closure, permits one profile POST and is discarded afterward. No cookie or token is exposed in the session contract.

`CloudflareThreadsAcquisitionAdapter` constructs only the canonical Threads post URL, for a GIF placeholder the exact post embed URL, and for a share token the official share URL. It sends browser-navigation request headers, `redirect: 'manual'`, `credentials: 'omit'`, no-store and a 10-second timeout. The share response is never followed: exactly one same-origin canonical post `Location` is accepted and re-parsed before the post request. The HTML body is bounded to 4 MiB; redirects, credentials and arbitrary destinations are rejected. The parser requires both the requested shortcode and publisher. GIF handling extracts only a direct `*.giphy.com/*.gif` URL from the exact post's embed image proxy; the Worker never fetches that GIF. No media bytes pass through the Worker.

The existing M4A parser/normalizer selects direct media candidates and preserves carousel order. Malformed children fail rather than silently reorder. Missing structure means PARSER_OUTDATED; unavailable/auth/rate/network errors retain typed categories. The Worker validates a narrow success response (at most 100 assets) before sending it, without raw JSON, headers, cookies or stacks. Only normalized post, trace, response-derived kind and transport identity are returned.

API output includes Cache-Control: no-store, Pragma: no-cache and explicit configurable CORS without Access-Control-Allow-Credentials. There are no media routes, caches, bindings, persistence or background processing. Wrangler builds locally with a dry run; deployment is separate.

## Extension (local, dual-platform)

`apps/extension` is a Chromium MV3 extension that is built separately, packaged deterministically into a versioned GitHub Releases ZIP and loaded unpacked by users. It is not part of the Pages deployment. Its service worker and popup are bundled with esbuild; no server component is added.

Flow:

```text
popup → one manual URL or active tab → background service worker
      → Instagram (credentials: include, no Cookie header constructed)
      → existing Instagram parser/normalizer → in-memory MediaAsset list
      → Threads local adapter (credentials: omit, official origin only)
      → existing Threads parser/share validator/GIF fallback/normalizer
      → browser-native download (media bytes source CDN → device)
```

- **Platform routing:** `target.ts` parses Instagram Post/Reel/Story and Threads canonical post/share shapes independently. Unsupported Threads paths never fall through to Instagram, and Instagram dispatch keeps its existing strategies and ordering.
- **Post/Carousel/Reel:** attempts background fetch, isolated content script and MAIN world in order. The first successful parse wins. `resolveStrategyOutcome` returns sanitized diagnostics plus in-memory assets.
- **Story:** `story/ref.ts` accepts only an explicit media id; `story/route.ts` also recognizes a username-only URL solely to reject it with `UNSUPPORTED_CONTENT`. No page-state, DOM, fiber, history or visible-media inspection exists in the stable release.
- **Identity invariant:** `matchOwner(routeUsername, responseOwner)` must not be `false`. A `false` result is `mismatch` and returns no asset. An absent response owner is `unknown` and does not itself reject an explicit-id URL; the explicit id remains authoritative.
- **Threads adapter:** `threads/acquisition.ts` fetches only constructed `https://www.threads.com` post, embed and share URLs with `credentials: 'omit'`, no-store, no referrer and a 10-second timeout. HTML is bounded to 4 MiB. Canonical-post and share destinations are checked against the exact publisher/shortcode; a share redirect is followed by the browser and only its single final canonical URL is accepted. `header-rule.ts` installs a host-scoped `declarativeNetRequestWithHostAccess` session rule for the navigation headers Threads requires, then removes it. The rule is constrained to non-tab extension requests (`tabIds: [-1]`), `xmlhttprequest` on `https://www.threads.com/` only; it has no effect on Instagram or ordinary Threads browsing tabs, adds no cookies and blocks nothing. One shared lease serializes concurrent acquisitions, and worker start removes any rule left by an interrupted request.
- **Threads identity/reuse:** `resolveThreadsTarget` calls the existing `resolveThreadsInput`, so exact-post parsing, private/unavailable classification, official share-location validation, Giphy embed fallback and media normalization are not duplicated. A canonical post that Threads HTTP-redirects to the same shortcode under a current username is accepted; the SSR publisher is then checked against that final handle. Different shortcodes and non-redirect publisher mismatches remain rejected. GIF assets keep `image/gif` and original animated bytes. Threads filenames are `threads_<current-username>_<shortcode>[_NN].<ext>`, preserving platform identity, stable post identity, carousel order and the final MIME extension; Instagram's existing filename policy is untouched.
- **Download UX:** `download-flow.ts` reuses matching in-memory results for one target fingerprint or resolves then downloads. `createSingleFlight` blocks duplicate concurrent downloads. Nothing is persisted.
- **Protocol handshake:** popup and background share `EXTENSION_PROTOCOL_VERSION`; controls stay disabled on mismatch so a stale service worker cannot receive new requests.

Permissions are deliberately split: `activeTab`, `scripting`, `clipboardRead` and `declarativeNetRequestWithHostAccess` are required; `https://www.instagram.com/*` remains a required host permission; `https://www.threads.com/*` is an optional host permission requested only from a Threads Resolve/Download action. No `cookies`, `tabs`, `history`, `webRequest`, `storage` or `<all_urls>` permission is requested.

The research-only modules (`story/current-id.ts`, `story/visible-media.ts`, `story/identity-sources.ts`, `story/diagnostic.ts` and their tests) remain on `research/m8b-m8d-instagram-story` and are intentionally absent from the stable branch.

## Trace and UI

Fixture results remain processedLocally=true, remoteProxyUsed=false, credentialsExported=false with no resolution network requests. Worker results use processedLocally=false, metadataResolverUsed=true, mediaProxyUsed=false, credentialsExported=false. Compatibility field remoteProxyUsed=true denotes a remote **metadata intermediary**, not a media relay. The web client adds its Resolver origin to origin-only upstream metadata records. These records describe resolution, not subsequent direct media previews/downloads.

Worker results show “Resolution source: UniFetch Resolver” and separate resolution/media privacy statements; the UI labels the actual platform and GIF/native-video media class. Fixtures show “Demo fixture” and their accurate local trace. GIF downloads preserve original animated GIF bytes instead of running JPEG still-image normalization.

## Historical decision

M4C direct WebRuntime probes for public Image, Carousel and Reel each returned BROWSER_RESTRICTION in the tested environment, before cross-origin bootstrap. No live success/download was established by those probes. M4D was intentionally skipped because this already established the runtime decision. M5 changes normal production transport to the metadata Resolver, without adding an alternate Instagram profile.

## PWA

The manifest uses standalone display and a GET `/share` target. Service-worker precaching includes only shell HTML, JS, CSS and icons. Demo media is excluded, runtime caching is empty, and share/demo navigation fallback is denied. Fixed fictional demo metadata is compiled into JS. No resolved URL, metadata or media is intentionally cached. Hosting and browser caches are separate operator/browser responsibilities.

M5–M5.5 local validation established successful metadata resolution for the tested public Instagram image post, carousel and Reel, direct image preview, direct image Blob download and Open original. T1B added a separate public Threads resolver path and live-validated image, image carousel, native video, video-carousel child and GIF posts through local `workerd` and a `wrangler dev --remote` Cloudflare edge session. Browser downloads produced JPEG images, four ordered carousel JPEGs, MP4 and a 26-frame animated GIF; media bytes remained direct from the CDN. The Cloudflare Resolver is the current Web/PWA compatibility runtime for metadata; media is fetched directly by the user’s browser/device. These tests do not establish support for all public content. No public identifiers or raw response payloads were retained in source, fixtures or documentation.

E1 adds local Threads acquisition to the unpacked extension without changing the Web/PWA path. It uses `credentials: 'omit'` for every Threads metadata request and a temporary host-scoped navigation-header rule, then reuses the same Threads parser/share/GIF/normalizer. E2's review narrowed that rule to extension-only non-tab requests on the exact Threads origin, added a shared concurrent lease, startup cleanup and a bounded permission prompt. A real Chrome for Testing 156 production build produced verified files for an image, an ordered four-image carousel, native MP4, official share-link image/video and a 47-frame GIF. The v0.3.0 candidate remains unpublished; v0.2.0 remains the release baseline.
