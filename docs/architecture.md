# Architecture

The pnpm workspace builds a static Vue 3 PWA. There is no backend or media proxy.

## Boundaries

`core` owns domain types, the error system, URL validation/normalization, `RuntimeAdapter`, `Resolver` and `ResolverRegistry`. Zod validates input strings before URL parsing. Only explicitly recognized HTTP(S) hosts are accepted; credentials and custom ports are rejected. Known tracking parameters and fragments are removed; unknown functional query parameters remain.

`meta-resolver` matches normalized Instagram URLs to three local JSON fixtures. It returns cloned results and performs no network calls. Unknown Instagram paths return an explicit not-yet-implemented `UNSUPPORTED_CONTENT` error. Facebook and Threads are detected but have no registered resolver.

`runtime-web` implements small request/response/capability contracts. Ordinary requests are restricted to same-origin HTTP(S), with credentials omitted and no-store requested. The optional origin-session capability keeps cookie context and CSRF injection inside the runtime and permits browser-owned same-origin credentials only after explicit session preparation. Resolvers never use global fetch; only the runtime owns transport. A future extension/native runtime can implement the same contract. Neither exists in this milestone.

`downloader` accepts same-origin `/demo/` assets only and uses browser download anchors. Multiple assets are requested sequentially. There is no proxy, ZIP, transcoding or audio extraction.

`share-target` extracts one supported URL from URL, then text, then title. Unsafe schemes and lookalike hosts are rejected.

`web` owns transient Pinia resolution state (`IDLE`, `RESOLVING`, `RESOLVED`, `ERROR`), indeterminate loading, accessible forms, previews, selection, download actions and a trace panel. Vue escapes fixture text. No post-related state is persisted.

## Data flow

Explicit paste + Resolve (or an explicit OS share) → supported URL parsing → resolver registry → fixture lookup → cloned `ResolveResult` → preview and privacy panel → explicit download click → runtime → browser-native save.

The `/share` route reads its query, extracts one URL, replaces the browser route with `/`, then calls the same resolution store as manual input. No share payload is persisted.

## Offline Instagram parsing (M4A)

Future Instagram live resolution is separated into Acquisition → Parser → Normalizer → ResolveResult. M4A implements Parser + Normalizer only, exposed through `@unifetch/meta-resolver/instagram`. `parseInstagramMediaResponse(raw, expectedShortcode)` defensively reads the supplied structured response and preserves valid media candidates and carousel order. `normalizeInstagramMedia(media, canonicalUrl)` selects the largest pixel-area candidates and maps them to the existing core types with stable filenames and an offline trace.

Sanitized raw-response fixtures are separate from the UI fixtures, under `packages/meta-resolver/src/instagram/__fixtures__/`, and use only synthetic `media.invalid` URLs. Complete positive dimensions take precedence over incomplete dimensions; area ties and unknown areas retain source order. Invalid candidates are filtered, but malformed carousel children fail the whole parse rather than silently changing its item order. Missing structures produce `PARSER_OUTDATED`; explicit empty content produces `CONTENT_UNAVAILABLE`. Optional owner, caption and timestamp fields may be absent or malformed. Valid timestamps map to ISO strings. The supplied shortcode is authoritative.

No acquisition, live request path or production resolver integration is added. Normalization reports local processing, no proxy, no credential export and an empty network trace. The UI demo and arbitrary live-URL behavior remain unchanged; live acquisition and accurate live network traces are deferred to M4B/M4C.

## Instagram acquisition architecture (M4B)

Instagram URL → InstagramContentRef → InstagramAcquisitionAdapter → RuntimeAdapter → raw response → parseInstagramMediaResponse → normalizeInstagramMedia → ResolveResult.

`parseInstagramContentRef` accepts only post/Reel paths, canonicalizes `/reels/` to `/reel/` and uses HTTPS with the canonical host. URL kind is a routing hint, never the authoritative media type. `PolarisPostRootAcquisitionAdapter` prepares a runtime-owned origin session and builds one form-encoded POST using `PolarisPostRootQueryProfileV1`. The endpoint, document ID, app ID, version and session requirements live in one profile module. This profile is an unstable Instagram web implementation detail and may need replacement without changing the parser, normalizer or UI. M4B supports only this supplied profile, with no discovery, retry or alternate endpoint.

The optional `prepareOriginSession` capability owns the GET bootstrap and cookie context, returning only a session-bound request method. Requests specify a CSRF header injection requirement, never a token. The WebRuntime rejects cross-origin sessions before bootstrap because ordinary web JavaScript cannot access that origin's cookie context. For an accessible same-origin context it uses standards-compliant browser requests and reads CSRF only internally, with no saved token snapshot or application-storage writes. Opaque responses, browser policy restrictions and inaccessible session state produce `BROWSER_RESTRICTION`. Browser-controlled headers are not spoofed.

Acquisition classifies transport status and explicit rate-limit/login/unavailability signals, returns structured raw responses for M4A to interpret, and never calls the parser or normalizer itself. Its in-memory network records contain only origin and metadata purpose; the successful origin record covers bootstrap and POST, without URLs, shortcodes or credentials. M4A's offline trace is unchanged; combining a live acquisition trace into a production result is future integration work.

There is no backend, proxy fallback or CORS workaround. ExtensionRuntime / NativeRuntime remain future runtime options. No optional manual probe was added or run; deterministic tests use mocked transports only. M4B does not enable live production UI resolution: existing demo fixtures, PREVIEW indicators and arbitrary live-URL errors remain unchanged. M4C integration is not implemented.

## PWA

vite-plugin-pwa generates the manifest and service worker. Shell resources are precached; demo assets are excluded, runtime caching is empty, and `/share`/`/demo` navigation fallbacks are denied. Fixed fictional fixture metadata is compiled into application JavaScript. Static hosting must route `/share` to the HTML shell without caching share query data. The shell works offline after installation, but demo media has no intentional offline archive. Browser HTTP cache remains under browser/host control.

## Errors

Typed errors include a diagnostic code and safe message. The UI never renders raw exceptions or stack traces. Unexpected failures become `UNKNOWN`. Download notices distinguish browser download requests from confirmed filesystem writes, which the web app cannot verify.
