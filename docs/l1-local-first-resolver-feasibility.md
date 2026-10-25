# L1 — Local-First Resolver Feasibility

**Status:** CONDITIONAL GO to a narrow L2 proof of concept
**Date:** 2026-10-25
**Scope:** Instagram and Threads metadata acquisition, local execution, session handling, media export, and distribution feasibility
**Out of scope:** L2 implementation, production Resolver changes, Cloudflare deployment, Chromium Extension v0.3.0 changes, Facebook, credential scraping, privileged global injection into untrusted pages

## Evidence legend

| Tag     | Meaning                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| **[D]** | Documented and supported by an official specification, vendor document, or maintained project documentation |
| **[S]** | Confirmed by inspecting source code or a maintained implementation                                          |
| **[E]** | Experimentally observed in this repository or in a controlled environment                                   |
| **[P]** | Plausible but not verified; requires a specific test                                                        |
| **[X]** | Unsupported, blocked, or not permitted by the relevant platform/policy                                      |

This report did **not** send live requests to Instagram or Threads. It is based on repository inspection, official documentation, source review, and published compatibility data. No production code, Worker, Pages deployment, or extension was changed.

---

## 1. Executive summary

UniFetch's current Web/PWA resolver is dependent on a Cloudflare-origin metadata request. The repository already records a controlled production-edge observation: the anonymous Instagram bootstrap returned `200` with a CSRF context, but the fixed public metadata query returned HTTP `401` JSON and was classified as `LOGIN_REQUIRED`; the same request succeeded from a residential network. The exact mechanism is not proven, but the evidence is consistent with network-origin-dependent upstream behavior. It is **not** evidence that the user's account, device, or IP is blocked.

The four capabilities that are often conflated must be separated:

| Capability                     | Browser-only Web/PWA                              | Chromium Extension                                      | Tauri v2 shell                                        |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------- |
| Local TypeScript/WASM parsing  | Yes                                               | Yes                                                     | Yes                                                   |
| Local network acquisition      | Only CORS-readable public endpoints               | Yes, via extension host permissions and browser session | Yes, via native HTTP and/or an embedded external page |
| Local media download           | Yes, subject to CORS/CDN and platform save limits | Yes, browser-native download                            | Yes, native HTTP plus platform save APIs              |
| Authenticated platform session | No                                                | Yes, the browser's existing session                     | Potentially, via the WebView's own cookie store       |

Key conclusions:

1. **Browser-only Web/PWA cannot solve the 401 problem.** CORS, the same-origin policy, third-party cookie restrictions, and origin isolation prevent `unifetch.pages.dev` from reading an authenticated `instagram.com` response. WebAssembly does not change network permissions. Service Workers cannot intercept another origin's responses. An iframe cannot be scripted cross-origin. The PWA can continue to parse locally, preview, and download media, but public metadata still needs the Worker or a CORS-enabled endpoint. **[D]**
2. **The Chromium Extension v0.3.0 is the working local-first reference.** Its capabilities derive from required host permissions, the user's browser session, a background service worker, content scripts in ISOLATED/MAIN worlds, browser-native downloads, and a narrowly scoped `declarativeNetRequest` rule for Threads. These are Chromium-extension capabilities, not web-platform capabilities, and they do not transfer to mobile Safari/Chrome or to an ordinary PWA. **[S]**
3. **Tauri v2 external-origin IPC is real and materially better than the earlier manual experiment.** Tauri 2.12.5 injects its IPC initialization script into external top-level pages, re-runs initialization scripts after navigation/reload, and evaluates command access against the document origin. A remote origin can call a custom command only when a capability explicitly grants that command through `remote.urls`; otherwise remote custom-command invocation is denied. **[D]/[S]**
4. **Tauri still does not provide a high-level external-page/native bridge.** The supported path is manual: `initialization_script`, `on_page_load`, `on_navigation`, `eval`, capability-scoped IPC, and platform-specific native plugins. Cookie sharing between the WebView and native HTTP is manual and is not available through `Webview::cookies()` on Android. **[D]/[S]**
5. **Mobile distribution changes the answer.** Apple App Review Guideline 5.2.3 says apps should not include the ability to save/download media from third-party sources without explicit authorization; Google Play's IP policy similarly targets apps that encourage unauthorized downloading. A native iOS app for this use case therefore has a high App Store rejection risk, independent of whether the WebView technology works. Android APK sideloading is viable and consistent with the project's existing GitHub Releases distribution, but Play Store distribution carries the same policy risk. **[D]/[P]**
6. **Recommended architecture is a portfolio, not one universal binary.** Build a Tauri v2 **Android-first Local Session Shell** (optional desktop build) that reuses the Vue UI and TypeScript parsers, uses native HTTP for public metadata and media, and uses an exact-post external WebView only when an authenticated same-origin fetch is required. Keep the PWA + Worker for public/iOS use, keep the Chromium Extension unchanged for desktop, and do not pursue an iOS App Store app in L2. **[P]**

**L1 decision: CONDITIONAL GO.** The technical primitives exist, and a minimal L2 proof of concept is justified. A full product commitment is not justified until the PoC proves external-page session behavior on real Android/iOS/desktop WebViews, exact-origin IPC isolation, native media export, share entry, and acceptable distribution/legal risk.

---

## 2. Current UniFetch architecture and verified constraints

### 2.1 Components and trust boundaries

| Component                     | Role                                                                            | Trust boundary                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `apps/web` (Vue 3/PWA)        | UI, state, previews, selection, local fixture resolution, direct media requests | Browser origin `https://unifetch.pages.dev`; no Instagram session                                      |
| `apps/resolver-worker`        | Public Instagram/Threads metadata acquisition                                   | Cloudflare egress; sees one public URL and transient upstream metadata; no credentials, no media bytes |
| `apps/extension` (MV3 v0.3.0) | Local Instagram authenticated and Threads public resolution + download          | User's Chromium profile; browser session; no cookie export; no storage                                 |
| `packages/meta-resolver`      | URL refs, request construction, parsers, normalizers                            | Pure local code; no global `fetch`                                                                     |
| `packages/runtime-web`        | Browser request/download runtime                                                | Same-origin only in production; cross-origin session access rejected                                   |
| `packages/downloader`         | Browser-native downloads, filenames, ordering, image normalization              | Media bytes go directly to the device                                                                  |
| `packages/share-target`       | `/share` query parsing                                                          | One supported URL from URL/text/title                                                                  |

The current production split is deliberate: the Web/PWA never imports the extension and never receives its session context. The extension does not contact the Resolver. Media bytes never pass through the Worker. These invariants must be preserved in any new architecture.

### 2.2 The Instagram 401 observation

The repository records the following controlled observation in `docs/HANDOFF.md` and `docs/deployment.md`:

- Anonymous Instagram bootstrap: HTTP `200`, CSRF context present.
- Fixed public metadata query: HTTP `401` JSON, classified as `LOGIN_REQUIRED`.
- The same request from a residential network succeeded.
- Rolling back the Worker did not resolve it.
- The Worker code, parser, CORS policy, and deployment were not shown to be defective.

Classification: **[E]** for the observation; **[P]** for the mechanism. "Cloudflare egress is treated differently by Instagram" is the leading hypothesis, but IP reputation, TLS/client fingerprint, request-header differences, cookie/CSRF binding, rate limiting, and Instagram-side experiment assignment are not excluded. The research did not attempt to prove the mechanism, and no mass requests were made.

### 2.3 Non-negotiable constraints

1. One explicit user-supplied URL per action; no crawling, enumeration, or ID guessing.
2. Exact-post identity: shortcode and publisher must match; mismatches fail closed with no asset.
3. No Instagram/Threads password, cookie, token, or session export to UniFetch infrastructure.
4. Media bytes go directly from the source/CDN to the user's device; no media proxy.
5. No new server-side authenticated downloader.
6. Web/PWA must not claim extension-only or native-only capabilities.
7. The published Chromium Extension v0.3.0 must remain unchanged in this milestone.
8. `opencode.jsonc` remains untracked and is not committed or deleted.
9. Any L2 experiment must be isolated, non-production, reversible, and documented.

### 2.4 What "local-first" can mean

| Layer                        | Can be local in a PWA?                    | Can be local in an extension? | Can be local in a Tauri app? |
| ---------------------------- | ----------------------------------------- | ----------------------------- | ---------------------------- |
| Parsing/normalization        | Yes                                       | Yes                           | Yes                          |
| Public metadata fetch        | Only with CORS permission or a Worker     | Yes                           | Yes, native HTTP             |
| Authenticated metadata fetch | No                                        | Yes, existing browser session | Potentially, WebView session |
| Media download               | Yes, if CORS-readable or anchor-navigable | Yes                           | Yes, native HTTP             |
| Gallery/file export          | Platform-limited                          | Browser download              | Native platform APIs         |
| Session storage              | No platform session                       | Browser cookie store          | WebView cookie store         |

---

## 3. Browser/PWA feasibility

### 3.1 CORS and credentialed cross-origin requests

A normal web page at `https://unifetch.pages.dev` cannot read a response from `https://www.instagram.com` unless Instagram explicitly grants that origin through CORS. For credentialed requests, the response must use the exact requesting origin in `Access-Control-Allow-Origin` and must set `Access-Control-Allow-Credentials: true`; a wildcard `*` is invalid with credentials. **[D]** (MDN CORS credential error; Fetch/CORS specification)

A `no-cors` request can be sent, but the response is opaque and unreadable. It cannot provide metadata. A `mode: 'cors'` request without CORS permission fails before the response is exposed. A Service Worker cannot bypass this: it only controls its own scope/origin and cannot read another origin's response. **[D]**

### 3.2 Cookies, SameSite, and third-party context

Even if Instagram granted CORS, the browser would have to attach the user's Instagram cookies to a request initiated by `unifetch.pages.dev`. That is a third-party context:

- Cookies default to `SameSite=Lax` when no attribute is set; `SameSite=None` requires `Secure`. **[D]**
- Safari and Firefox block or partition third-party cookies by default or through tracking protection; Chrome's cookie/storage behavior is also being partitioned and changed over time. **[D]**
- `document.cookie` cannot read `HttpOnly` session cookies. **[D]**
- The PWA cannot read or write Instagram's origin storage; each origin has separate storage. **[D]**

Therefore, "just use `fetch` with `credentials: 'include'` from the PWA" is not a viable resolver design. It is blocked by CORS before cookie behavior even matters, and third-party cookie policy would remain a second barrier.

### 3.3 iframes, Service Workers, and WebAssembly

- **iframe:** The same-origin policy prevents a page from reading a cross-origin iframe's DOM or injecting scripts into it. `postMessage` is the only sanctioned cross-origin communication channel, and Instagram does not provide a metadata protocol for UniFetch. **[D]**
- **Service Worker:** A service worker can intercept fetches for clients it controls, not arbitrary cross-origin requests made by other origins. It cannot grant network permissions. **[D]**
- **WebAssembly:** Wasm runs in a sandbox and "will enforce the browser's same-origin and permissions policies." It can accelerate parsing, image processing, hashing, or ZIP creation, but it does **not** bypass CORS, cookie policy, or origin isolation. **[D]** (MDN WebAssembly concepts)

### 3.4 Share Target API

The Web Share Target API lets an installed PWA appear in the system share sheet. Registration requires an installed PWA served over HTTPS, with a web app manifest and a service worker for installability/POST handling; the target appears only after installation, not in an ordinary browser tab. Browser support is limited:

| Browser         | `share_target` support |
| --------------- | ---------------------- |
| Chrome desktop  | 89+                    |
| Chrome Android  | 76+                    |
| Firefox         | No                     |
| Safari/iOS      | No                     |
| Android WebView | No                     |

Source: MDN browser-compat-data, accessed 2026-10-25. **[D]**

This matches UniFetch's current reality: Android Chrome installed PWA gets a Share Target; iOS uses an Apple Shortcut to `/share`; desktop browsers do not have a system share target for the PWA. The Share Target API is not a solution for iOS or for local network acquisition.

### 3.5 File saving and multi-file downloads

- An `<a download>` or Blob URL can save a file, but cross-origin `download` attributes may be ignored; a CORS-readable fetch is needed to produce a Blob. **[D]/[E]**
- The File System Access API (`showSaveFilePicker`, `showDirectoryPicker`) is available in Chromium desktop and recent Chrome Android, but not Safari or Firefox. **[D]** (MDN; BCD)
- iOS Safari does not provide the File System Access API; multi-file saves typically go through the share sheet or repeated save actions. UniFetch already documents an iOS Save queue. **[D]/[E]**
- The PWA can download media that the CDN exposes with CORS; it cannot force a CDN to allow a cross-origin read.

### 3.6 Browser/PWA verdict

| Question                                         | Answer                                                                                                              |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Can the PWA parse metadata locally?              | Yes. The parsers are pure TypeScript and can run in a Worker/Wasm.                                                  |
| Can the PWA acquire Instagram metadata locally?  | No for authenticated content; public content only if a CORS-readable endpoint exists. No such endpoint is verified. |
| Can the PWA download media locally?              | Yes, subject to CORS/CDN and platform save restrictions.                                                            |
| Can the PWA access the user's Instagram session? | No. It is a different origin and has no extension privileges.                                                       |
| Can Wasm fix this?                               | No. It changes computation, not network permissions.                                                                |
| Can a Service Worker fix this?                   | No. It cannot read another origin's responses.                                                                      |
| Can an iframe fix this?                          | No. Cross-origin DOM access is blocked.                                                                             |

**Browser-only is a NO-GO for replacing the Cloudflare-origin metadata resolver with local authenticated acquisition.** It remains a good public UI and a public-content fallback, but it cannot be the local-first authenticated resolver.

---

## 4. Chromium Extension reference architecture

### 4.1 What v0.3.0 actually relies on

| Capability                                     | Mechanism in v0.3.0                                                                                                    | Transferable to PWA/Tauri?                                              |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Cross-origin Instagram fetch with user session | Required host permission `https://www.instagram.com/*`; `credentials: 'include'`; no Cookie header constructed         | No to PWA; partially to Tauri WebView                                   |
| Local parsing/normalization                    | Shared `@unifetch/meta-resolver` packages                                                                              | Yes                                                                     |
| Background execution                           | MV3 service worker                                                                                                     | No; Tauri uses Rust/WebView lifecycle                                   |
| Page-context fallback                          | `chrome.scripting.executeScript` in ISOLATED and MAIN worlds                                                           | No direct equivalent; Tauri can inject scripts but not extension worlds |
| Threads navigation headers                     | Session-scoped `declarativeNetRequestWithHostAccess` rule, `tabIds: [-1]`, exact host, `xmlhttprequest`                | No; Tauri can set request headers natively or in WebView                |
| Downloads                                      | Browser-native download / Blob; direct CDN                                                                             | Yes conceptually; Tauri needs native download/save                      |
| Permissions                                    | `activeTab`, `scripting`, `clipboardRead`, `declarativeNetRequestWithHostAccess`; Instagram required; Threads optional | Not applicable; Tauri uses capabilities                                 |

**[S]** Source: `apps/extension/src/background.ts`, `injected.ts`, `strategy.ts`, `threads/header-rule.ts`, `target.ts`, `download-flow.ts`; `apps/extension/manifest.json`.

### 4.2 Strategy behavior worth reusing

- Background fetch first, then isolated content script, then MAIN world. The first successful parse wins. **[S]**
- CSRF context is prepared by a same-origin bootstrap GET and HTML extraction; no cookie API is used. **[S]**
- Instagram requests use `credentials: 'include'` and never construct a `Cookie` header. **[S]**
- Threads requests use `credentials: 'omit'`, exact official origin, bounded HTML, and a temporary header rule. **[S]**
- Identity checks fail closed; a mismatched owner returns no asset. **[S]**
- Downloads reuse one in-memory result per target fingerprint and a single-flight guard. **[S]**

### 4.3 What must not be broadened

The published extension's permission model is part of its trust story. L1 does not recommend adding `cookies`, `tabs`, `history`, `webRequest`, `storage`, `<all_urls>`, or a broader DNR rule. The extension should remain the desktop reference, not become the vehicle for the mobile/local-first experiment.

### 4.4 Extension verdict

**The extension is the best existing proof that local, session-aware resolution works on desktop Chromium.** It is not a mobile solution: mainstream Chrome for Android does not support this extension model, and iOS cannot run Chromium extensions. Its architecture is reusable as a pattern (host permission + browser session + local parser + direct download), but the APIs are not portable.

---

## 5. Tauri v2 external-WebView/IPC capability matrix

### 5.1 Version context

| Item                               | Value                                                  |
| ---------------------------------- | ------------------------------------------------------ |
| Current stable Tauri               | 2.12.5, published 2026-10-21                           |
| Current stable WRY                 | 0.57.1, published 2026-10-23                           |
| Current stable `tauri-plugin-http` | 2.8.3, published 2026-10-14                            |
| Tauri 3                            | 3.0.0-alpha.5 exists (2026-10-21); **not used for L2** |
| Evidence date                      | 2026-10-25                                             |

Sources: crates.io metadata and docs.rs, accessed 2026-10-25. **[D]**

### 5.2 Capability matrix

| Capability                                                  | Status today                                                                                   | Evidence                                                                                                                                     | Important limits                                                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Load an external `https://` URL in a Tauri WebView          | Supported API on desktop and mobile                                                            | **[D]** `WebviewUrl::External`; `WindowConfig.url`; **[S]** `prepare_webview` handles external URLs generically                              | Mobile rendering and third-party-site behavior must be tested per OS/WebView version                              |
| Inject application JavaScript before page scripts           | Supported                                                                                      | **[D]** `WebviewBuilder::initialization_script`                                                                                              | Main frame only; runs on all top-level navigations; Android remote-URL fallback may run later than document start |
| Re-run injection after navigation/reload                    | Supported                                                                                      | **[D]** `Webview::navigate`/`reload` documentation; **[S]** initialization scripts are re-added                                              | The ACL origin changes with the new document URL                                                                  |
| Call a custom Rust command from an external page            | Supported only with an explicit remote capability                                              | **[D]** Capabilities "Remote API Access"; **[S]** Tauri source explicitly denies remote custom commands without a matching remote capability | Must use `remote.urls`; use `local: false` for a remote-only capability; no wildcard host                         |
| Call official plugin commands from an external page         | Same ACL model                                                                                 | **[D]/[S]**                                                                                                                                  | Never grant `fs`, `http`, `shell`, `opener`, `dialog`, `process` to a remote page                                 |
| Use the event system from an external page                  | Available if core event permissions are granted                                                | **[D]** Event system docs; docs state events have no fine-grained capability control                                                         | Avoid for sensitive data; no global broadcasts; prefer command return values                                      |
| Use channels from an external page                          | Available as a command argument                                                                | **[D]** Channels docs; docs state channels have no capability control                                                                        | Only if the command itself is remote-allowed; not needed for metadata                                             |
| Use custom protocols / asset protocol from an external page | Possible but not recommended                                                                   | **[D]/[P]**                                                                                                                                  | CORS/scheme/origin issues; do not expose arbitrary files                                                          |
| Read WebView cookies from Rust                              | Desktop/iOS: yes, including HttpOnly; Android: returns empty                                   | **[D]** `Webview::cookies`, `cookies_for_url`; Android explicitly unsupported                                                                | Highly sensitive; avoid by default; no cookie values in JS/logs                                                   |
| Set/delete WebView cookies                                  | Documented                                                                                     | **[D]** `Webview::set_cookie`, `delete_cookie`                                                                                               | Verify Android behavior separately; still sensitive                                                               |
| Native HTTP request independent of page CORS                | Supported via Rust `reqwest` / `tauri-plugin-http`                                             | **[D]** HTTP plugin supports Windows, Linux, macOS, Android, iOS                                                                             | The plugin uses its **own** cookie jar, not the WebView's cookies                                                 |
| Native HTTP with the WebView session                        | Manual bridge                                                                                  | **[S]** Maintainer statements: plugin cannot read WebView cookies; use `reqwest` yourself for a custom jar                                   | Android `cookies()` is unsupported; custom JNI/CookieManager may be required                                      |
| Native download handler                                     | Desktop and iOS source paths exist; Android WRY source has no download handler                 | **[S]** WRY source: WebView2, WebKitGTK, WKWebView download handlers; no Android equivalent found                                            | Prefer a native Rust download command, not `on_download`                                                          |
| Navigation validation                                       | Supported                                                                                      | **[D]** `on_navigation`, `on_page_load`                                                                                                      | `on_new_window` is unsupported on Android/iOS                                                                     |
| Multi-webview                                               | Desktop only behind `unstable`; mobile not stable                                              | **[D]** `WebviewBuilder` is behind `unstable`                                                                                                | Use a single window/webview for the L2 PoC                                                                        |
| Session isolation / clearing                                | Supported with platform differences                                                            | **[D]** `data_directory`, `data_store_identifier`, `incognito`, `clear_all_browsing_data`                                                    | Linux clears the shared web context; Android cookies API is limited                                               |
| Remote iframe isolation                                     | Main-frame-only injection plus invoke key; Linux/Android cannot distinguish iframe from window | **[D]/[S]** Capabilities docs; CVE-2024-35222 fix                                                                                            | Treat same-origin iframes as same privilege; avoid untrusted iframes                                              |

### 5.3 External-origin IPC: what is actually supported

The important source-level finding is in Tauri's `Webview::on_message`:

- The IPC initialization script is added to every webview, including a webview whose URL is external.
- The access-control origin is derived from the current document URL: local app URLs become `Origin::Local`; other URLs become `Origin::Remote { url }`.
- A remote request reaches a custom command only if `RuntimeAuthority::resolve_access` finds a capability whose `remote.urls` URLPattern matches the document origin and whose window/webview labels match.
- The source comment states that this "ensures remote content can never reach custom commands unless an explicit `remote` capability has been configured for them."
- `Webview::navigate` documentation explicitly says initialization scripts and the IPC bridge keep working after navigation, and that the ACL origin changes with the URL.

**[S]** Tauri source, `crates/tauri/src/webview/mod.rs`, `crates/tauri/src/ipc/authority.rs`, `crates/tauri/src/manager/webview.rs`, inspected 2026-10-25. **[D]** Tauri capabilities and `navigate` docs.

This is materially stronger than the earlier manual experiment: the bridge is no longer an ad-hoc global function with ambient native access. It is a capability-scoped IPC channel whose default for remote custom commands is deny.

### 5.4 What is still manual

Tauri provides primitives, not an external-page integration product. The following remain application work:

1. **Login/session orchestration.** Opening a login page, letting the user authenticate, detecting success, and returning to the post without exposing native commands to the login page.
2. **Same-origin fetch injection.** Injecting a script that performs the Instagram GraphQL request with the WebView's credentials and returns only bounded data.
3. **Cookie sharing with native HTTP.** `tauri-plugin-http` has its own cookie jar; it does not automatically use WebView cookies. Reading cookies is platform-limited and sensitive.
4. **Native download and gallery export.** Android MediaStore and iOS Photos add-only access need small native plugins or platform code; `on_download` is not a complete mobile answer.
5. **Share entry.** Android `ACTION_SEND` needs an intent filter and native handler; iOS needs a Share Extension or the existing Shortcut/deep link.
6. **Background/lifecycle handling.** Mobile apps are suspended; long downloads need native background URLSession or an Android foreground service.
7. **Security validation.** Every remote payload must be treated as untrusted; the capability boundary is necessary but not sufficient.

### 5.5 Plugins and community implementations

| Project                                       | Status                                      | Assessment                                                                                                |
| --------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `tauri-plugin-http` (official)                | Stable 2.8.3, all platforms                 | Recommended for native HTTP; CORS bypass; URL scope; **own cookie jar**, not WebView cookies              |
| `tauri-plugin-fs` (official)                  | Stable, all platforms                       | App-scoped file access; not a gallery exporter; Android/iOS access is app-folder limited by default       |
| `tauri-plugin-dialog` (official)              | Stable, desktop/mobile                      | Save/open dialogs; useful on desktop                                                                      |
| `tauri-plugin-deep-link` (official)           | Stable, all platforms                       | Custom scheme/App Link/Universal Link; not an Android share-sheet receiver                                |
| `tauri-plugin-android-fs` (community)         | 30.2.0, active (2026-10-11), ~79k downloads | Useful Android public-storage helper; still third-party; review source and Play policy                    |
| `tauri-plugin-ios-photos` (community)         | 0.3.0, 2025-12-31, ~607 downloads           | Small project; album/asset management, not a minimal add-only saver; review before use                    |
| `tauri-plugin-mobile-sharetarget` (community) | 2.0.0, 2025-12-24, ~629 downloads           | Handles mobile share intents with a FIFO queue; small ecosystem; iOS still needs a Share Extension target |
| `tauri-plugin-sharesheet` (community)         | 0.0.1, 2024-08-29                           | Stale; not recommended without a fork/review                                                              |
| `tauri-plugin-share` (community)              | 2.0.5, 2024-11-15                           | Stale; iOS share extension setup is manual; review before use                                             |

**No official Tauri plugin provides an external-page/native bridge.** The supported approach is Tauri core primitives plus a small, audited native plugin where necessary. Community plugins should be pinned, reviewed, and preferably vendored or replaced with in-repo code for a security-sensitive app.

### 5.6 Security advisories that affect the design

| Advisory                             | Impact                                                                                                                                    | Fixed                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| CVE-2024-35222 / GHSA-57fm-592m-34r7 | Remote-origin iframes could access Tauri IPC endpoints; IPC init was injected into iframes on macOS                                       | Tauri 1.6.7 and 2.0.0-beta.20; current 2.x includes the fix |
| CVE-2026-42184 / GHSA-7gmj-67g7-phm9 | `is_local_url()` origin confusion on Windows/Android allowed a remote page whose subdomain matched a custom scheme to be treated as local | Tauri 2.11.1; current 2.12.5 includes the fix               |

Sources: GitHub Advisory Database, published 2024-05-23 and 2026-05-06. **[D]**

**Implication:** pin Tauri to a current 2.12.x release (at least 2.11.1), monitor advisories, and do not use a Tauri 3 alpha for L2. A remote-page bridge is a security-sensitive feature; the app must assume the remote page is hostile.

### 5.7 Tauri verdict

**Technically feasible, but not a turnkey external-page solution.** The core primitives and capability model are sufficient for a controlled L2 PoC. The unresolved risks are platform behavior (especially mobile WebView login and Android cookie/download support), distribution policy, and the amount of manual native work. Tauri should not be adopted merely because `invoke` works; it should be adopted only if the PoC proves the whole flow and the security boundary.

### 5.8 Direct answers to the ten external-WebView questions

1. **Can Tauri v2 load external origins across Windows, macOS, Linux, Android, and iOS?** Yes as an API: `WebviewUrl::External` accepts an `http`/`https` URL and is handled generically by Tauri's webview preparation. The engine is the OS WebView, so rendering, login, and anti-bot behavior differ by platform and must be tested. **[D]/[P]**
2. **Can scripts be injected after navigation and reload?** Yes. `initialization_script` runs at document start on every top-level navigation, and `Webview::navigate`/`reload` explicitly re-run initialization scripts and the IPC bridge. `eval` can execute additional code later. The script is main-frame only unless `initialization_script_for_all_frames` is used. **[D]/[S]**
3. **Which IPC mechanisms work from an injected script?** `invoke` works through `window.__TAURI_INTERNALS__` (or the official `@tauri-apps/api` client bundled into the injected script), subject to the remote capability. Events and channels are available only if the command/permission surface allows them; they have no fine-grained payload ACL. Custom protocols are technically available but are not recommended for untrusted pages. **[D]/[S]**
4. **How do external origins compare with application-owned pages?** Application-owned pages are `Origin::Local` and can use local capabilities. External pages are `Origin::Remote` and need a capability with `remote.urls`; otherwise remote custom commands are denied. Initialization scripts still run, but cookies, CSP, asset protocol, plugin access, and navigation behavior are the remote site's context, not the app's. Do not expose a global privileged bridge. **[D]/[S]**
5. **Are there maintained plugins/libraries/patterns that simplify the bridge?** Official plugins cover HTTP, filesystem, dialogs, deep links, and similar primitives, but no official plugin provides an external-page/native bridge. Community share-sheet/gallery plugins exist but are small or stale; they must be reviewed/vendored. The documented pattern is still manual `initialization_script` + capability-scoped `invoke`. **[D]/[S]**
6. **Can native network requests bypass the embedded site's CORS?** Yes. Rust `reqwest` / `tauri-plugin-http` performs requests outside the WebView's CORS model, with URL scoping. It does **not** automatically use the WebView's cookies; the plugin has its own cookie jar. **[D]/[S]**
7. **Can the WebView reuse an actual authenticated login session?** Potentially yes, because the WebView owns a real cookie store. Desktop/iOS expose `cookies()`; Android returns empty through Tauri's cross-platform API. Login pages may be challenged by Instagram, and sharing the session with native HTTP requires a manual, sensitive bridge. The recommended design performs the authenticated fetch inside the WebView and never exports the cookie. **[D]/[S]/[P]**
8. **What are the WKWebView/Android WebView/WebView2/WebKitGTK differences?** See the table in section 6: engine/version, script-injection timing, cookie store, download handler, background behavior, file/gallery APIs, share entry, and distribution all differ. The biggest practical differences are Android's missing Tauri cookie read, WKWebView's App Store/ITP context, and WebKitGTK's non-Chromium rendering. **[D]/[S]**
9. **How do mobile backgrounding, storage, file export, photo libraries, and permissions affect the architecture?** Tauri core does not provide background URLSession, Android foreground services, MediaStore, Photos, or share extensions. These require native Swift/Kotlin plugins. Mobile apps are suspended; long downloads need native background APIs. Media export should use app-created media permissions (MediaStore own-media; Photos add-only), not broad library access. **[D]/[S]**
10. **What security boundaries are necessary?** Exact-origin/path remote capability; `local: false`; one submit command; no fs/http/shell/opener/process/event permissions for remote; no global bridge; navigation allowlist; pending-request and payload validation; no cookie export; session isolation; iframe caution; Tauri ≥2.11.1; independent review. See section 8. **[D]/[S]**

---

## 6. Android/iOS and desktop differences

| Dimension         | Android                                                                                          | iOS                                                                      | Windows                                    | macOS                                                 | Linux                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------ |
| WebView engine    | Android System WebView (Chromium, updatable via Play Store)                                      | WKWebView (WebKit, tied to OS)                                           | WebView2 (Chromium, Evergreen)             | WKWebView (WebKit, tied to OS)                        | WebKitGTK 4.1                                                      |
| Script injection  | `addDocumentStartJavaScript` when supported; Tauri falls back to `onPageStarted` for remote URLs | `WKUserScript` at document start                                         | `AddScriptToExecuteOnDocumentCreated`      | `WKUserScript` at document start                      | WebKit user script at document start                               |
| Cookie store      | `android.webkit.CookieManager`, process-wide                                                     | `WKHTTPCookieStore` / `WKWebsiteDataStore`                               | WebView2 cookie manager / user data folder | `WKHTTPCookieStore`                                   | WebKit cookie manager / web context                                |
| Tauri cookie read | **Unsupported** (`cookies()` returns empty)                                                      | Supported                                                                | Supported (avoid synchronous deadlock)     | Supported                                             | Supported                                                          |
| Native HTTP       | Rust `reqwest` / OkHttp; CORS bypass                                                             | Rust `reqwest` / URLSession; CORS bypass                                 | Rust `reqwest`; CORS bypass                | Rust `reqwest`; CORS bypass                           | Rust `reqwest`; CORS bypass                                        |
| Save to gallery   | MediaStore; own media needs no storage permission on Android 10+                                 | Photos add-only (`NSPhotoLibraryAddUsageDescription`) or share sheet     | Save dialog / Downloads folder             | Save panel / Downloads folder                         | Save dialog / Downloads folder                                     |
| Share entry       | `ACTION_SEND` intent filter + native handler                                                     | Share Extension + App Group, or Shortcut/deep link                       | Paste/clipboard; no standard share target  | Paste/clipboard; Share Extension possible             | Paste/clipboard                                                    |
| Background        | Foreground service / WorkManager                                                                 | Background `URLSession`; app suspension                                  | Normal desktop process                     | Normal desktop process                                | Normal desktop process                                             |
| Distribution      | APK via GitHub Releases (viable); Play Store policy risk                                         | App Store likely blocked by 5.2.3; TestFlight/Ad Hoc/EU alternative only | MSI/NSIS; direct distribution              | DMG/notarization; direct distribution; App Store risk | AppImage/deb/Flatpak                                               |
| Main risk         | WebView/login variability; Play policy                                                           | **Distribution**, WKWebView login, Photos permission                     | WebView2 runtime availability              | WKWebView login; notarization                         | WebKitGTK compatibility/version; Instagram may serve degraded page |

### 6.1 Android

- Technically the most promising mobile target for a Tauri shell. The System WebView is Chromium-based and generally closer to the extension's behavior than WKWebView.
- Tauri's Android script-injection path has a documented fallback: when `addDocumentStartJavaScript` is unavailable, Tauri uses `onPageStarted` for remote URLs, which is not guaranteed to run before other page scripts. This does not break capability-based IPC, but it can affect bridge timing. **[D]**
- `Webview::cookies()` is unsupported on Android, so a native HTTP client cannot read the WebView session through Tauri's cross-platform API. A native Kotlin `CookieManager` bridge is possible but adds a sensitive interface. The recommended design avoids it by doing session-aware fetches inside the WebView. **[D]/[S]**
- MediaStore can publish app-created media without broad storage permissions on Android 10+. A small Kotlin plugin can write the downloaded file and set `IS_PENDING` while writing. **[D]**
- Android share entry is a custom `ACTION_SEND` intent filter; Tauri's official deep-link plugin is not a share-sheet receiver. **[D]/[P]**
- Play Store distribution is a policy risk under the IP/unauthorized-download policy; GitHub Releases APK distribution avoids store review but not legal/ToS risk. **[D]/[P]**

### 6.2 iOS

- WKWebView can load external HTTPS pages and run `WKUserScript` at document start. Tauri's WebView API supports external URLs and `initialization_script`. **[D]**
- Login in an embedded WKWebView may work, but Instagram can challenge, show an "open in app" interstitial, or serve a degraded page. This is unverified and must be tested with a real account/device. **[P]**
- Tauri's `cookies()` supports iOS, but reading session cookies is exactly the kind of sensitive interface UniFetch has avoided. The in-page fetch design avoids it. **[D]/[S]**
- Saving to Photos requires `NSPhotoLibraryAddUsageDescription` and add-only authorization; a small Swift plugin can use `PHPhotoLibrary.performChanges` / `PHAssetCreationRequest`, or `UISaveVideoAtPathToSavedPhotosAlbum` for video. **[D]**
- Share entry requires a Share Extension target and App Group, or the existing Apple Shortcut/deep link. A Share Extension is a separate Xcode target and significantly more work than Android's intent filter. **[D]/[P]**
- **Distribution is the decisive limitation.** Apple Guideline 5.2.3 says apps should not include the ability to save, convert, or download media from third-party sources without explicit authorization from those sources. Guideline 5.2.2 also requires permission under the third-party service's terms. An Instagram downloader is therefore a high App Store rejection risk. TestFlight is also reviewed and time-limited; Ad Hoc is device-limited; EU alternative distribution is region-limited. **[D]/[P]**
- **Recommendation:** do not plan an iOS App Store product in L2. Keep the PWA + Shortcut for iPhone users. A TestFlight/personal build can be used for technical validation only, with explicit distribution caveats.

### 6.3 Windows

- WebView2 is Chromium-based and widely available; Tauri can bootstrap the Evergreen runtime.
- Native HTTP, save dialogs, and filesystem access are straightforward.
- There is no standard system share sheet for a desktop app; users paste a URL or use the clipboard. A custom URL scheme or browser integration could be added later.
- Direct installer distribution is viable; no store review. Desktop authenticated resolution is already served by the Chromium extension, so a Tauri desktop build is optional unless a standalone app is a product goal.

### 6.4 macOS

- WKWebView is built in; `WKUserScript` injection is reliable at document start.
- Native HTTP, save panel, and notarization are straightforward.
- App Store distribution has the same 5.2.3 risk; direct notarized distribution avoids it.
- The Chromium extension already covers desktop authenticated resolution; a Tauri macOS app is optional.

### 6.5 Linux

- WebKitGTK is not Chromium. Instagram may serve a different page, require a different user agent, or fail in ways the extension never sees. This is a real compatibility risk, not a theoretical one. **[P]**
- Tauri supports external URLs and script injection, but WebKitGTK version differences across distributions complicate support.
- Direct AppImage/deb/Flatpak distribution is viable.
- Linux should be best-effort in L2, not a launch blocker.

### 6.6 Platform conclusion

| Platform  | Technical feasibility | Distribution feasibility          | L2 priority              |
| --------- | --------------------- | --------------------------------- | ------------------------ |
| Android   | Medium-high           | Medium (APK sideload)             | **Primary**              |
| iOS       | Medium                | **Low/blocked** (App Store 5.2.3) | Deferred; PWA + Shortcut |
| Windows   | High                  | High (direct installer)           | Optional/secondary       |
| macOS     | High                  | High (notarized direct)           | Optional/secondary       |
| Linux     | Medium                | High (direct packages)            | Best-effort              |
| Web/PWA   | Low for local auth    | High                              | Keep public path         |
| Extension | High (desktop)        | High (existing)                   | Keep unchanged           |

---

## 7. Comparison with alternative architectures

### 7.1 Candidates

- **A. Tauri v2 Local Session Shell** — Vue UI + Rust core + external Instagram WebView for session-aware fetches + native HTTP/download/save.
- **B. Extension-first + PWA fallback** — keep the existing extension for desktop and the Worker-backed PWA for public content; add nothing native.
- **C. Native Android shell + iOS PWA/Shortcut** — Kotlin WebView app for Android; no iOS native app.
- **D. Native iOS WKWebView shell** — Swift app with WKWebView + URLSession + Photos; technically possible, distribution-blocked.
- **E. Local companion service** — PWA + localhost helper for desktop.
- **F. Hybrid PWA + native helper** — PWA UI plus a native helper for resolution/download.
- **G. Wasm parser/downloader** — local computation only; no network privilege.

### 7.2 Comparison matrix

Ratings: **Strong**, **Partial**, **Weak**, **Blocked**.

| Criterion                          | A. Tauri                                                   | B. Extension + PWA                                       | C. Android native                                 | D. iOS native                            | E. Companion       | F. Hybrid                    | G. Wasm            |
| ---------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------- | ------------------ | ---------------------------- | ------------------ |
| Share-sheet integration            | Android strong; iOS weak; desktop paste                    | Desktop weak; Android PWA strong; iOS Shortcut           | Android strong                                    | iOS strong if Share Extension            | Desktop weak       | Android strong; iOS Shortcut | N/A                |
| Local execution                    | Strong                                                     | Strong on desktop; PWA public only                       | Strong                                            | Strong                                   | Strong (desktop)   | Strong                       | Strong             |
| Authenticated content              | Potentially strong                                         | Strong on desktop; none on PWA                           | Strong                                            | Strong                                   | Strong (desktop)   | Strong                       | None               |
| Resistance to origin-dependent 401 | Strong if local IP/session works                           | Strong on desktop; none on PWA                           | Strong                                            | Strong                                   | Strong (desktop)   | Strong                       | None               |
| Remote infrastructure              | None/optional                                              | Worker required for PWA                                  | None                                              | None                                     | None               | None/optional                | None               |
| Credential security                | Medium-high (WebView session; avoid cookie reads)          | High (no cookie export)                                  | Medium (CookieManager access)                     | Medium (WKHTTPCookieStore)               | Medium             | Medium                       | High (no session)  |
| Mobile installation                | Android medium; iOS low                                    | PWA high; extension no                                   | Android medium                                    | iOS low                                  | None               | Android medium; iOS low      | PWA high           |
| Store review                       | Android Play risk; iOS blocked                             | N/A                                                      | Android Play risk                                 | iOS blocked                              | N/A                | Android Play risk            | N/A                |
| Multi-media/gallery export         | Strong with native plugins                                 | Strong on desktop; PWA partial                           | Strong                                            | Strong                                   | Strong (desktop)   | Strong                       | Partial            |
| Maintenance                        | Medium-high (5 platforms)                                  | Low-medium                                               | Medium                                            | Medium                                   | Medium             | High                         | Low                |
| Code reuse                         | High (Vue/TS)                                              | Very high                                                | Medium (UI reuse possible)                        | Medium                                   | Medium             | High                         | High               |
| Engineering effort                 | Medium-high                                                | Low (already exists)                                     | High                                              | High                                     | Medium             | High                         | Low-medium         |
| Overall                            | Best cross-platform reuse, but mobile/distribution caveats | Best safety and lowest effort, but does not solve mobile | Best Android control, but duplicate platform work | Technically viable, distribution-blocked | Niche desktop only | Complex                      | Not a resolver fix |

### 7.3 Why not force Tauri

Tauri is not automatically the winner:

- The Chromium extension already solves desktop authenticated resolution with less risk and no new distribution.
- Tauri's iOS benefit is nullified by App Store policy.
- Android-native code may be more reliable for WebView, CookieManager, share intents, MediaStore, and foreground services.
- A Tauri app adds a new release pipeline, code signing, notarization, Android SDK/Xcode builds, and a second UI/runtime surface to maintain.
- The external-page bridge is security-sensitive and must be maintained against Tauri/WebView changes.

Tauri is justified only if the PoC shows that one codebase can deliver a materially better Android (and optionally desktop) experience than the existing PWA/extension, without weakening the security model.

### 7.4 Why not local companion

A localhost companion can solve desktop CORS and session problems, but it does not help Android/iPhone, requires installing and running a helper, and introduces localhost CORS/Private Network Access and lifecycle issues. It is a niche desktop option, not the primary architecture.

### 7.5 Why not Wasm alone

Wasm can make parsing faster and enable local image/ZIP work, but it cannot acquire a session or bypass CORS. It is an optimization, not a resolver architecture.

---

## 8. Threat model and mitigations

### 8.1 Assets

- The user's Instagram/Threads session cookies and any derived CSRF context.
- The user's media files and filesystem.
- Native capabilities: network, filesystem, shell/opener, downloads.
- Exact-post identity and the integrity of the resolved result.
- The user's device and other apps' data.
- The integrity of the UniFetch build and its dependencies.

### 8.2 Adversaries

- A malicious or compromised remote page running in the WebView (Instagram/Threads itself, an XSS, or a malicious redirect).
- A malicious deep link, share intent, or pasted URL.
- A malicious or compromised media URL/response.
- A network attacker (mitigated by HTTPS, but redirects and DNS are still relevant).
- A local attacker or another app on the device.
- A compromised dependency, plugin, or build pipeline.
- A future Tauri/WebView vulnerability.

### 8.3 Trust boundaries

```text
Untrusted remote WebView (Instagram/Threads)
        │  capability-scoped IPC only
        ▼
Rust core (trusted)  ◄── local UI WebView (trusted app origin)
        │
        ├── native HTTP (exact hosts, no arbitrary URLs)
        ├── filesystem / MediaStore / Photos (scoped)
        └── OS share/deep-link entry (validated)
```

### 8.4 Threats and mitigations

| Threat                                       | Mitigation                                                                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote page invokes download/fs/shell        | Remote capability grants exactly one submit command; `local: false`; no `fs`/`http`/`shell`/`opener`/`dialog`/`process` permissions; no global bridge; command-side validation; no wildcard remote URL          |
| Remote page forges metadata or media URLs    | Pending-request state; exact canonical URL/shortcode; schema validation; asset count/size caps; HTTPS; host allowlist; no redirects; reject private/local destinations                                          |
| Remote page reads or exfiltrates cookies     | Never expose `cookies()` or `document.cookie` to the remote page; in-page fetch uses browser credentials without returning them; no cookie values in IPC, logs, or UI; no `Authorization`/`Cookie` construction |
| Remote page abuses events/channels           | Do not grant `core:event:*` to remote capability; no global sensitive events; channels only as arguments to the single allowed command                                                                          |
| Iframe privilege escalation                  | Main-frame-only initialization; invoke key; no remote iframe capability; avoid loading untrusted iframes; note Linux/Android iframe-origin limitation; validate every payload                                   |
| Origin confusion / navigation to attacker    | `on_navigation` exact host/path allowlist; reject cross-origin redirects; capability exact origin/path; pin Tauri ≥2.11.1; test path-pattern behavior                                                           |
| Login page has native bridge                 | Separate login webview or path-scoped remote capability that excludes `/accounts/login`; no IPC on login; return to exact post only after user action                                                           |
| SSRF via media URL                           | HTTPS only; host allowlist (`*.cdninstagram.com`, `*.fbcdn.net`, `*.giphy.com` as applicable); no userinfo/custom ports; no redirects; DNS/IP sanity checks; time/size caps                                     |
| Session leakage across accounts              | Dedicated data directory/data store; clear session action; do not share a WebView with the local UI; Android CookieManager is process-wide, so document and test                                                |
| Deep link/share injection                    | Parse exactly one supported URL; reject profiles/search/arbitrary schemes; no credentials; require explicit Resolve/Download action; no shell execution                                                         |
| Path traversal / file overwrite              | Rust-generated filenames; sanitize; fixed save roots; MediaStore/Photos APIs; no remote-supplied paths; no overwrite without confirmation                                                                       |
| Dependency/supply chain                      | Pin Tauri 2.12.x; lockfile; review/vendor community plugins; no Tauri 3 alpha; audit native Kotlin/Swift; monitor advisories                                                                                    |
| Logs/telemetry leakage                       | Typed errors only; no raw URLs, cookies, tokens, headers, or response bodies; no analytics; redact in crash reports                                                                                             |
| Background/suspension data loss              | Native background URLSession/foreground service; checkpoint download state; clean temp files; no persistent metadata history                                                                                    |
| Cross-site privilege escalation via local UI | Local UI has its own capability; remote page cannot navigate it; no shared event bus with sensitive payloads; validate all local UI inputs                                                                      |

### 8.5 Exact-post identity invariants

The existing Extension's safety principles must be preserved:

1. Parse the user's input into one exact content reference before any network request.
2. Reject unsupported paths, profiles, search, `/t/`, non-post share links, and multi-item Story responses.
3. For share links, expand only one official same-origin redirect to an exact canonical post; re-parse the result.
4. Before opening the external WebView, compute the canonical post/reel URL and shortcode.
5. Allow navigation only to the exact canonical URL (plus an explicit login flow with no bridge).
6. Injected script checks `location.origin` and `location.pathname`; returns the observed URL and shortcode.
7. Rust compares observed URL/shortcode to the pending request; parser checks shortcode and publisher; owner mismatch returns no asset.
8. Reject cross-origin redirects, login/challenge pages, shortcode changes, and publisher changes.
9. Fail closed with a typed error; never substitute a "nearby" post or guessed ID.
10. One pending request at a time; no enumeration.

### 8.6 Proposed remote capability shape

Illustrative only; exact URLPattern behavior must be verified in L2:

```json
{
  "identifier": "instagram-exact-post-remote",
  "description": "Allow the exact Instagram post/reel document to submit one bounded raw metadata response.",
  "local": false,
  "windows": ["session"],
  "remote": {
    "urls": [
      "https://www.instagram.com/p/*",
      "https://www.instagram.com/reel/*"
    ]
  },
  "permissions": ["unifetch:allow-submit-raw-response"]
}
```

The local UI gets a separate capability for parsing, preview, download, and save. The remote capability must not include `fs`, `http`, `shell`, `opener`, `dialog`, `process`, or event permissions. If path-scoped URLPattern matching proves unreliable on a platform, fall back to a dedicated session webview that only ever loads the exact post, plus strict command-side path validation.

### 8.7 Residual risks

- A compromised Instagram page can forge a response for its own post; the app can validate structure and identity but cannot prove the page's honesty. This is inherent to using the platform's own page as a transport.
- Same-origin iframes may share the remote origin's privilege on Linux/Android; the minimal command surface and payload validation are the main mitigations.
- Tauri/WebView vulnerabilities are outside the app's control; pinning and monitoring are required.
- The user's session is still a sensitive asset even if UniFetch never reads it; a compromised WebView or OS can expose it.
- App Store/Play policy and Instagram ToS are product/legal risks, not engineering problems that can be fully mitigated in code.

---

## 9. Evidence and references

### 9.1 Repository evidence

| Claim                                                                                                     | Evidence                                                                                                    | Classification |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------- |
| Web/PWA uses a Cloudflare Worker for metadata; no direct cross-origin Instagram acquisition in production | `docs/architecture.md`, `packages/runtime-web/src/index.ts`                                                 | **[S]**        |
| Worker bootstrap 200 + metadata 401 + residential success                                                 | `docs/HANDOFF.md` §16.7, `docs/deployment.md`                                                               | **[E]**        |
| Extension uses host permissions, browser session, service worker, content scripts, DNR, browser downloads | `apps/extension/src/background.ts`, `injected.ts`, `strategy.ts`, `threads/header-rule.ts`, `manifest.json` | **[S]**        |
| Extension does not request `cookies`, `tabs`, `history`, `webRequest`, `storage`, `<all_urls>`            | `apps/extension/manifest.json`, `docs/HANDOFF.md` §17.3                                                     | **[S]**        |
| Threads DNR rule is `tabIds: [-1]`, exact host, `xmlhttprequest`, removed after use                       | `apps/extension/src/threads/header-rule.ts`                                                                 | **[S]**        |
| Story username-only fails closed; explicit ID only                                                        | `apps/extension/src/story/route.ts`, `docs/HANDOFF.md` §5.4                                                 | **[S]**        |
| Existing exact-post parser checks shortcode/publisher and fails closed                                    | `packages/meta-resolver/src/instagram`, `packages/meta-resolver/src/threads`                                | **[S]**        |

### 9.2 Official documentation and source

| Topic                                                                         | Source                                                                                                          | Date                    |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Tauri 2.12.5 API                                                              | https://docs.rs/tauri/latest/tauri/                                                                             | 2026-10-21              |
| Tauri capabilities / remote API access                                        | https://v2.tauri.app/security/capabilities/                                                                     | Last updated 2026-09-03 |
| Tauri `WebviewBuilder::initialization_script`                                 | https://docs.rs/tauri/latest/tauri/webview/struct.WebviewBuilder.html                                           | 2026-10-21              |
| Tauri `Webview::navigate`, `cookies`, `set_cookie`, `clear_all_browsing_data` | https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html                                                  | 2026-10-21              |
| Tauri calling Rust / calling frontend / channels                              | https://v2.tauri.app/develop/calling-rust/ and https://v2.tauri.app/develop/calling-frontend/                   | 2026-06-08 / 2026-09-09 |
| Tauri HTTP plugin                                                             | https://v2.tauri.app/plugin/http-client/                                                                        | 2025-02-22              |
| Tauri file system plugin                                                      | https://v2.tauri.app/plugin/file-system/                                                                        | Current                 |
| Tauri App Store guide                                                         | https://v2.tauri.app/distribute/app-store/                                                                      | Current                 |
| Tauri source: IPC initialization and ACL                                      | `crates/tauri/src/manager/webview.rs`, `crates/tauri/src/webview/mod.rs`, `crates/tauri/src/ipc/authority.rs`   | Inspected 2026-10-25    |
| Tauri source: capability `remote` and `local`                                 | `crates/tauri-utils/src/acl/capability.rs`, `crates/tauri-utils/src/acl/resolved.rs`                            | Inspected 2026-10-25    |
| CVE-2026-42184                                                                | https://github.com/advisories/GHSA-7gmj-67g7-phm9                                                               | Published 2026-05-06    |
| CVE-2024-35222                                                                | https://github.com/advisories/GHSA-57fm-592m-34r7                                                               | Published 2024-05-23    |
| Tauri iOS background/webview recovery issue                                   | https://github.com/tauri-apps/tauri/issues/14371                                                                | Fixed 2026-04-14        |
| Tauri HTTP plugin cookie limitation                                           | https://github.com/tauri-apps/plugins-workspace/issues/1167 and #2375                                           | 2024/2025               |
| MDN CORS credential error                                                     | https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSNotSupportingCredentials               | 2025-07-04              |
| MDN cookies / SameSite / third-party cookies                                  | https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies                                                | 2026-09-17              |
| MDN same-origin policy                                                        | https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy                               | 2026-09-17              |
| MDN WebAssembly concepts                                                      | https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/Concepts                                            | 2026-10-07              |
| MDN Share Target                                                              | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target               | 2026-08-27              |
| MDN File System API                                                           | https://developer.mozilla.org/en-US/docs/Web/API/File_System_API                                                | 2026-09-12              |
| Browser compatibility data                                                    | https://github.com/mdn/browser-compat-data                                                                      | Accessed 2026-10-25     |
| Apple App Review Guidelines 4.2, 5.2.2, 5.2.3, 2.5.6                          | https://developer.apple.com/app-store/review/guidelines/                                                        | Accessed 2026-10-25     |
| Apple Photos add-only authorization                                           | https://developer.apple.com/documentation/photokit/delivering-an-enhanced-privacy-experience-in-your-photos-app | Current                 |
| Apple background URLSession                                                   | https://developer.apple.com/documentation/foundation/downloading-files-in-the-background                        | Current                 |
| Android MediaStore                                                            | https://developer.android.com/training/data-storage/shared/media                                                | Current                 |
| Google Play IP policy                                                         | https://support.google.com/googleplay/android-developer/answer/9888072                                          | Accessed 2026-10-25     |
| Tauri community plugin metadata                                               | https://crates.io and GitHub repositories                                                                       | Accessed 2026-10-25     |

### 9.3 Evidence classification summary

- **Documented/supported:** CORS/cookie/SOP/Wasm behavior; Share Target and File System Access support; Tauri external URL, initialization scripts, capabilities, remote API access, cookie APIs, navigation hooks, plugin platform support; Apple/Google policy text; Android MediaStore; Apple Photos.
- **Source-confirmed:** Tauri injects IPC into external pages; remote custom commands are denied without a remote capability; capability `local`/`remote` handling; WRY download handler platform coverage; extension architecture and permissions.
- **Experimentally observed:** the repository's Cloudflare 401 vs residential success; prior extension live tests; prior manual Tauri invoke experiment (historical, not re-run here).
- **Plausible but unverified:** Instagram login in WKWebView/Android WebView; same-origin GraphQL fetch from an injected Tauri script; local native HTTP avoiding 401; media CDN requiring/not requiring cookies; Tauri path-scoped URLPattern behavior; Android/iOS gallery save; share intent; background downloads; App Store/Play review outcomes.
- **Unsupported/blocked:** browser-only authenticated Instagram acquisition; Wasm/Service Worker/iframe CORS bypass; iOS App Store distribution of a third-party media downloader without authorization; Android Play distribution of unauthorized download functionality; Tauri 3 alpha for production.

---

## 10. Recommended architecture and rationale

### 10.1 Recommendation

Adopt a **portfolio architecture**:

1. **Keep the Chromium Extension v0.3.0 unchanged** as the desktop local-first reference and the safest authenticated Instagram path.
2. **Keep the PWA + Cloudflare Worker** for public content, Android PWA Share Target, iOS Shortcut, and users who do not install a native app. Do not pretend the PWA has local authenticated resolution.
3. **Build a Tauri v2 Android-first Local Session Shell** as the new local-first candidate, with an optional desktop build:
   - Vue UI reused from the existing app where practical.
   - Rust native HTTP for public Instagram/Threads metadata and media.
   - An exact-post external Instagram WebView only when a session-aware same-origin fetch is needed.
   - Native MediaStore/Photos/save integration.
   - Android share intent; iOS Shortcut/deep link, not a native iOS app in L2.
4. **Do not pursue an iOS App Store app in L2.** Validate iOS WKWebView only as a technical experiment if a TestFlight/personal distribution path is explicitly accepted; otherwise keep PWA + Shortcut.
5. **Keep the Worker as an optional public fallback**, not as the primary Tauri resolver. No credentials, no media relay, no expansion.

### 10.2 Why this portfolio

- It preserves the existing safe desktop path instead of replacing a working extension with a riskier native app.
- It gives Android users a local-first option without App Store gatekeeping.
- It acknowledges that iPhone local-first distribution is blocked by policy, not by a missing API.
- It reuses the Vue UI and TypeScript parsers, which is the main code-reuse advantage of Tauri.
- It keeps the Worker for users who cannot or will not install anything, without making the Worker the only path.

### 10.3 Component design

```text
┌─────────────────────────────────────────────────────────────┐
│ Local UI (Vue, trusted app origin)                          │
│  - URL input / share handoff / preview / selection / save   │
│  - existing TS parser + normalizer                          │
└───────────────┬─────────────────────────────────────────────┘
                │ local capability (parse, download, save)
┌───────────────▼─────────────────────────────────────────────┐
│ Rust core                                                   │
│  - exact URL/ref validation                                 │
│  - public native HTTP (Instagram fixed profile / Threads)   │
│  - pending-request state + response validation              │
│  - media download + filename policy                         │
│  - platform save (MediaStore / Photos / save dialog)        │
└───────────────┬─────────────────────────────────────────────┘
                │ one remote capability: submit raw response
┌───────────────▼─────────────────────────────────────────────┐
│ Exact-post Instagram WebView (untrusted remote origin)      │
│  - loads only the canonical post/reel URL                   │
│  - injected script performs same-origin fetch with session  │
│  - returns bounded JSON only; no cookie/token export        │
└─────────────────────────────────────────────────────────────┘
```

### 10.4 Resolver request flows

**Public Instagram (preferred):**

```text
User URL → local UI parses exact ref → Rust native HTTP
  → Instagram fixed bootstrap + metadata (no credentials, no redirects)
  → bounded JSON → local TS parser/normalizer → preview
  → Rust media download (signed CDN URL) → device save
```

**Authenticated Instagram / public 401 fallback:**

```text
User URL → local UI parses exact ref → Rust opens exact-post WebView
  → injected script checks origin/path → same-origin fetch (credentials include)
  → bounded JSON → Rust validates pending ref/shortcode
  → local TS parser/normalizer → preview
  → Rust media download → device save
```

**Threads public:**

```text
User URL → local UI parses exact Threads ref/share
  → Rust native HTTP (canonical SSR, credentials omit, manual redirect)
  → bounded HTML → existing Threads parser/share validator/GIF fallback
  → preview → Rust media download → device save
```

**PWA (unchanged):**

```text
PWA → Worker → public Instagram/Threads metadata
  → normalized metadata + direct asset URLs → PWA
  → browser/device direct media request
```

### 10.5 Where sessions and cookies live

- By default, the Instagram session lives **only in the WebView's platform cookie store**. It is not copied into the local UI, Rust state, logs, or IPC payloads.
- The login flow uses a WebView with **no native bridge** (or a path-scoped capability that excludes login). The exact-post session WebView shares the same app data store but only loads the exact post.
- On desktop/iOS, the app can clear the session with `clear_all_browsing_data` or platform cookie APIs. On Android, use `CookieManager` in native code; document that it is process-wide.
- Native HTTP does **not** use the WebView session by default. If a future case truly needs it, read cookies in Rust only, bind them to the exact origin, never serialize them, and clear them after the request. This is a last resort, not the default.

### 10.6 Where parsing runs

- Parsing/normalization runs in the **local UI** (trusted app origin) using the existing TypeScript packages. This keeps one parser source of truth and avoids bundling the parser into the remote page.
- The remote page returns only a bounded raw response body; Rust validates size/content-type and the pending exact-post identity before forwarding it to the local parser.
- If IPC size becomes a problem, parse in the injected script and return normalized metadata, but keep the same validation and fail-closed rules. The raw-response design is preferred for code reuse and auditability.

### 10.7 Downloads and exports

- Rust downloads media directly from the CDN using validated HTTPS URLs. No UniFetch server is in the media path.
- Desktop: save dialog / Downloads folder; preserve order with `_01`…`_NN`.
- Android: write to app cache, then publish via MediaStore (`IS_PENDING` while writing); no broad storage permission for app-created media on Android 10+.
- iOS: write to a temp file, then Photos add-only (`NSPhotoLibraryAddUsageDescription`) or the share sheet; no full-library permission.
- Reuse the existing filename policy (caption-first, sanitized, stable shortcode fallback) and MIME-based extension. Do not invent timestamps.

### 10.8 Is the remote Worker needed?

- For the Tauri app: **no** for the local path. Native HTTP and the exact-post WebView cover public and authenticated cases. The Worker is an optional public fallback.
- For the PWA: **yes** for public metadata, because the browser cannot do the cross-origin authenticated fetch.
- For the extension: **no**.
- Do not add credentials, media proxying, or authenticated acquisition to the Worker.

### 10.9 Platform scope

| Platform      | L2 scope           | Rationale                                                            |
| ------------- | ------------------ | -------------------------------------------------------------------- |
| Android       | Primary            | APK sideload; share intent; MediaStore; WebView session              |
| Windows/macOS | Optional/secondary | Reuse UI; native HTTP; save dialog; extension already covers desktop |
| Linux         | Best-effort        | WebKitGTK compatibility risk; direct distribution                    |
| iOS           | Deferred           | App Store 5.2.3; use PWA + Shortcut                                  |
| PWA           | Keep public path   | Cannot solve local auth; keep Worker                                 |
| Extension     | Keep unchanged     | Working desktop reference                                            |

---

## 11. Explicit unresolved questions

1. Does Instagram allow a normal login in Tauri's Android System WebView, WKWebView, WebView2, and WebKitGTK without an "unsupported browser"/challenge interstitial?
2. Does a same-origin GraphQL fetch from an injected script in those WebViews return the same metadata as the extension's background fetch?
3. Does Instagram serve full post metadata to WKWebView/WebKitGTK user agents, or a degraded/login page?
4. Does native HTTP from a residential/mobile IP avoid the Cloudflare-origin 401 consistently, or is the difference account/header/fingerprint-related?
5. Do Instagram CDN media URLs for authenticated posts require cookies, or are the signed URLs sufficient for native download?
6. Does Tauri's `remote.urls` URLPattern match the full document path on every platform, and does it behave correctly after SPA navigation?
7. Does `initialization_script` reliably run before page scripts on older Android System WebView remote URLs?
8. Does `Webview::set_cookie`/`delete_cookie` behave on Android despite `cookies()` returning empty?
9. Can Android MediaStore and iOS Photos add-only export be implemented reliably from a small native plugin without broad permissions?
10. Can Android `ACTION_SEND` and iOS Share Extension/deep link deliver a URL with acceptable friction?
11. Do mobile background/suspension and WebView process termination preserve or recover the session and download state?
12. Does Tauri 2.12.5 on Linux WebKitGTK render and execute Instagram acceptably?
13. Will App Store/Play review reject the app under 5.2.3/IP policy even if the app only downloads user-selected public content? This is a product/legal decision, not a code test.
14. Does the app's use of Instagram's internal GraphQL endpoint violate Instagram's terms in the target jurisdictions? Legal review needed.
15. Can the exact-post bridge be kept safe if the remote page is compromised (same-origin iframe, forged response, event/channel abuse)?
16. What is the binary size, cold-start time, memory use, and battery impact on low-end Android devices?
17. How are app updates delivered for Android sideload and desktop direct installs, and how are users notified?

---

## 12. Minimal, testable L2 proof-of-concept proposal

### 12.1 Purpose

Prove or disprove the recommended architecture with the smallest reversible experiment. The PoC is **not** a product, not a production branch, and not a reason to change the Worker, Pages, or Extension v0.3.0.

### 12.2 Isolation

- Branch: `research/l2-tauri-local-poc`, created from the L1 branch or `main`.
- Location: a separate `research/l2-tauri-local-poc/` directory, not part of the production pnpm workspace build.
- No changes to `apps/web`, `apps/resolver-worker`, `apps/extension`, or production configuration.
- No deployment, no release, no force-push, no merge to `main`.
- Use synthetic or user-owned test content; no private third-party content; no mass requests.

### 12.3 Scope

**In scope:**

1. Tauri 2.12.x app with a local Vue UI.
2. Public Instagram single image via native HTTP + existing parser.
3. Public Threads single image via native HTTP + existing Threads parser.
4. Authenticated Instagram single image via exact-post WebView + same-origin fetch + existing parser.
5. Native download of one image on desktop and Android.
6. Android share intent → app → resolve.
7. Security boundary tests (remote command allowlist, navigation, forged payload, cookie non-export).
8. Session clear action.

**Out of scope:**

- iOS App Store build.
- Carousel/video/GIF breadth beyond one regression sample.
- Background downloads.
- Multi-account support.
- Story support.
- Facebook.
- Production UI polish.
- Worker/extension changes.

### 12.4 Test matrix

| Test                                     | Desktop (macOS or Windows) | Android                | iOS (optional)              |
| ---------------------------------------- | -------------------------- | ---------------------- | --------------------------- |
| Public Instagram image, native HTTP      | Required                   | Required               | Deferred                    |
| Public Instagram image, WebView fallback | Required                   | Required               | Optional                    |
| Authenticated Instagram image, WebView   | Required                   | Required               | Optional                    |
| Public Threads image, native HTTP        | Required                   | Required               | Deferred                    |
| Media download + save                    | Required                   | Required (MediaStore)  | Optional (Photos)           |
| Share/deep-link entry                    | Paste (desktop)            | `ACTION_SEND` required | Shortcut/deep link optional |
| Wrong shortcode/owner                    | Required                   | Required               | Optional                    |
| Remote page tries download/fs            | Required                   | Required               | Optional                    |
| Navigation to non-Instagram origin       | Required                   | Required               | Optional                    |
| Session clear                            | Required                   | Required               | Optional                    |
| Background/resume                        | Optional                   | Required (basic)       | Optional                    |

### 12.5 Success criteria

The PoC is successful only if all of the following hold:

1. One public Instagram image resolves and saves locally on Android and one desktop OS **without** the Cloudflare Worker.
2. One authenticated Instagram image resolves through the WebView session and saves locally, with no cookie/token read by application JS or Rust.
3. One public Threads image resolves and saves locally through native HTTP and the existing parser.
4. A wrong shortcode, wrong publisher, unsupported path, login/challenge page, or cross-origin redirect fails closed with no asset.
5. The remote page cannot invoke download, filesystem, HTTP, shell, opener, or event commands; only the single submit command is reachable.
6. No cookie, token, raw header, or full URL appears in logs, IPC payloads, or UI.
7. Session clear removes the Instagram session and the next authenticated request fails closed until login.
8. Android share intent opens the app with the URL; desktop paste works.
9. Builds are reproducible from a clean checkout; the production workspace and extension remain untouched.

### 12.6 Security tests

- From the remote page console, attempt `invoke('download_asset', …)` → must be denied by ACL.
- Attempt `invoke('plugin:fs|write_file', …)` → denied.
- Attempt `invoke('plugin:http|fetch', …)` → denied.
- Submit a forged payload with a different shortcode → rejected by Rust.
- Submit an oversized payload → rejected.
- Navigate to `https://example.com` → blocked by `on_navigation`.
- Navigate to Instagram login/challenge → no submit command available or command rejects.
- Attempt to read `document.cookie` from the injected bridge → no such code path; verify no cookie values in IPC.
- Inspect Rust logs and WebView devtools → no cookies/tokens.
- Verify `clear_all_browsing_data`/CookieManager clears the session.

### 12.7 Effort estimate

| Work                                              | Rough effort |
| ------------------------------------------------- | ------------ |
| Tauri scaffold + build pipeline                   | 2–4 days     |
| Public Instagram native HTTP + parser reuse       | 2–3 days     |
| Public Threads native HTTP + parser reuse         | 1–2 days     |
| Exact-post WebView + injected bridge + capability | 4–6 days     |
| Rust validation + download + filename reuse       | 3–5 days     |
| Android MediaStore plugin                         | 2–4 days     |
| Android share intent                              | 1–2 days     |
| Security tests + docs                             | 2–3 days     |
| Desktop packaging (optional)                      | 2–3 days     |

These are engineering estimates, not commitments. The unknown platform behaviors can expand them significantly.

### 12.8 L2 stop conditions

Stop and report back if any of these occur:

- Instagram blocks or challenges WebView login on both Android and desktop.
- Same-origin GraphQL fetch from the injected script fails consistently.
- Tauri remote capability cannot be restricted to the exact post path without exposing native commands to login/other pages.
- Native download/save cannot be made reliable on Android without broad permissions.
- The only working distribution path is an App Store/Play submission that policy review would reject.
- The security boundary requires a privileged global bridge or cookie export.

---

## 13. Go / No-Go criteria

### 13.1 L1 → L2

**CONDITIONAL GO.** Proceed to the minimal L2 PoC described above because:

- Tauri 2.12.5 provides the required external-origin IPC primitives with a deny-by-default remote command model.
- The existing parsers, request builder, identity checks, and download policy are reusable.
- Android APK distribution is viable and consistent with the project's existing release style.
- The main unknowns are testable in a bounded PoC.

Do **not** proceed to L2 as a full product rewrite. The PoC must remain isolated.

### 13.2 L2 → product

**GO** only if all L2 success criteria pass and:

- Legal/product review accepts the Instagram/Threads terms and App Store/Play policy risk for the chosen distribution.
- Android + one desktop platform work reliably with real accounts and public samples.
- The remote capability boundary is independently reviewed.
- No cookie/token export or privileged global bridge is introduced.
- The PWA/extension invariants remain intact.
- Maintenance ownership and release process are defined.

**CONDITIONAL** if only public content works, or only one platform works. Then ship a narrower public-only local helper, not an authenticated downloader.

**NO-GO** if:

- Mobile WebView login/fetch is blocked or unreliable.
- The only safe implementation requires broad native permissions, cookie export, or a global bridge.
- Native save/share cannot meet the product experience.
- Policy/legal review rejects the distribution model.
- The PoC shows the architecture is more fragile than the existing extension/PWA.

---

## 14. Appendix: source-to-claim map

| Claim                                                             | Primary evidence                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------- |
| Browser cannot read cross-origin authenticated Instagram metadata | MDN CORS credential error; MDN SOP; Fetch spec                    |
| Third-party cookies are restricted                                | MDN Cookies/SameSite; browser privacy docs                        |
| Wasm does not bypass CORS                                         | MDN WebAssembly concepts ("same-origin and permissions policies") |
| Share Target is Chromium-only                                     | MDN `share_target`; BCD                                           |
| File System Access is Chromium-only                               | MDN File System API; BCD                                          |
| Extension uses host permissions/session/SW/scripts/DNR/downloads  | Extension source; manifest; HANDOFF §17                           |
| Tauri loads external URLs                                         | `WebviewUrl::External`; `WindowConfig.url`; source                |
| Tauri injects scripts before page scripts on navigation           | `initialization_script` docs; `navigate` docs; source             |
| Tauri remote custom commands require remote capability            | Capabilities docs; `Webview::on_message` source comment           |
| Tauri `cookies()` Android unsupported                             | `Webview::cookies` docs                                           |
| Tauri HTTP plugin has its own cookie jar                          | Plugin docs; maintainer issues #1167/#2375                        |
| Tauri `on_download` lacks Android handler                         | WRY source                                                        |
| Tauri `on_new_window` unsupported on mobile                       | `WebviewBuilder` docs                                             |
| Tauri multiwebview is unstable                                    | `WebviewBuilder` docs                                             |
| Tauri CVEs and patches                                            | GitHub advisories                                                 |
| iOS App Store 5.2.3 risk                                          | Apple App Review Guidelines                                       |
| Android Play IP policy risk                                       | Google Play IP policy                                             |
| Android MediaStore own-media access                               | Android developer docs                                            |
| iOS Photos add-only                                               | Apple Photos docs                                                 |
| 401 observation                                                   | Repo HANDOFF/deployment docs                                      |

---

**End of report.**
