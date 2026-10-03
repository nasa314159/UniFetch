# Architecture

The pnpm workspace builds a static Vue 3 PWA. There is no backend or media proxy.

## Boundaries

`core` owns domain types, the error system, URL validation/normalization, `RuntimeAdapter`, `Resolver` and `ResolverRegistry`. Zod validates input strings before URL parsing. Only explicitly recognized HTTP(S) hosts are accepted; credentials and custom ports are rejected. Known tracking parameters and fragments are removed; unknown functional query parameters remain.

`meta-resolver` matches normalized Instagram URLs to three local JSON fixtures. It returns cloned results and performs no network calls. Unknown Instagram paths return an explicit not-yet-implemented `UNSUPPORTED_CONTENT` error. Facebook and Threads are detected but have no registered resolver.

`runtime-web` implements small request/response/capability contracts. Requests are restricted to same-origin HTTP(S), with credentials omitted and no-store requested. Resolvers never use global fetch; only the runtime owns transport. A future extension/native runtime can implement the same contract. Neither exists in this milestone.

`downloader` accepts same-origin `/demo/` assets only and uses browser download anchors. Multiple assets are requested sequentially. There is no proxy, ZIP, transcoding or audio extraction.

`share-target` extracts one supported URL from URL, then text, then title. Unsafe schemes and lookalike hosts are rejected.

`web` owns transient Pinia resolution state (`IDLE`, `RESOLVING`, `RESOLVED`, `ERROR`), indeterminate loading, accessible forms, previews, selection, download actions and a trace panel. Vue escapes fixture text. No post-related state is persisted.

## Data flow

Explicit paste + Resolve (or an explicit OS share) → supported URL parsing → resolver registry → fixture lookup → cloned `ResolveResult` → preview and privacy panel → explicit download click → runtime → browser-native save.

The `/share` route reads its query, extracts one URL, replaces the browser route with `/`, then calls the same resolution store as manual input. No share payload is persisted.

## PWA

vite-plugin-pwa generates the manifest and service worker. Shell resources are precached; demo assets are excluded, runtime caching is empty, and `/share`/`/demo` navigation fallbacks are denied. Fixed fictional fixture metadata is compiled into application JavaScript. Static hosting must route `/share` to the HTML shell without caching share query data. The shell works offline after installation, but demo media has no intentional offline archive. Browser HTTP cache remains under browser/host control.

## Errors

Typed errors include a diagnostic code and safe message. The UI never renders raw exceptions or stack traces. Unexpected failures become `UNKNOWN`. Download notices distinguish browser download requests from confirmed filesystem writes, which the web app cannot verify.
