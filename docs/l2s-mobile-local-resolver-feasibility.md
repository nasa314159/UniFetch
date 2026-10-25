# L2S — Low-Friction Mobile Local Resolver Feasibility

**Status:** CONDITIONAL GO to a device-gated iOS Shortcut experiment and a small diagnostics/fallback milestone; NO-GO for a zero-install Android local transport
**Date:** 2026-10-25
**Branch:** `research/l2s-mobile-local-resolver`
**Base:** `main` at `44086be`, plus docs-only L1 (`f9764ee`) and L2A (`8b15e3b`) research reports
**Scope:** Instagram resolution reliability on Android and iPadOS/iPhone, Apple Shortcuts native HTTP, Android browser/PWA transport limits, Resolve-stage diagnostics, and a minimal Shortcut-to-Web handoff design
**Out of scope:** production Worker/Pages deployment, production Web/PWA changes, Chromium Extension v0.3.0 changes, L2B external-WebView/session-bridge work, mandatory Android APK, W1 filename synchronization, Facebook, authenticated acquisition, credential export, challenge bypass, proxy rotation, CAPTCHA solving, fingerprint spoofing, GUI automation

---

## Evidence legend

| Tag     | Meaning                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------ |
| **[D]** | Documented by an official specification, vendor document, or maintained project documentation                |
| **[S]** | Confirmed by inspecting repository source code or a maintained implementation                                |
| **[E]** | Experimentally observed in this repository or in a controlled environment                                    |
| **[P]** | Plausible, implemented in a credible third-party example, or inferred, but not verified on the target device |
| **[X]** | Unsupported, blocked, or not permitted by the relevant platform/policy                                       |

Two distinctions matter throughout this report:

- **macOS simulation is not iOS Shortcuts execution.** The macOS HTTP results establish what the Instagram endpoint accepts from an ordinary native HTTP client. They do not prove that the iOS Shortcuts actions serialize the same headers/body or that iOS permits them.
- **A typed `LOGIN_REQUIRED` is not proof that the post requires login.** The current Worker uses that code for bootstrap login pages, GraphQL `401`/`403`/redirects, missing CSRF context, and GraphQL login-required payloads. The public error contract does not identify which one occurred.

---

## 1. Executive summary and verdict

The current mobile failures are real, but they are not a normal download/gallery failure and they are not evidence that the user's Instagram account is blocked.

What was confirmed:

1. The production Resolver returned `HTTP 403` with `LOGIN_REQUIRED` for a public Instagram sample that resolved successfully from a non-Cloudflare network with the anonymous CSRF cookie and header. The production error text was the GraphQL-stage message (`Instagram requires login for this content`), not the bootstrap or CSRF-extraction message. This places the failure at the **GraphQL response**, after a successful bootstrap.
2. A public Threads sample resolved successfully through the same production Resolver during the same session. The Worker, CORS, Pages origin, and general upstream transport were healthy. The failure is Instagram-specific and upstream-stage-specific.
3. The current Web UI discards the Worker's more specific safe message for known error codes and shows one generic `LOGIN_REQUIRED` message. A user cannot tell whether the bootstrap, the CSRF extraction, or the GraphQL response failed. The code is displayed, but the code alone conflates at least three different causes.
4. An iPad resolved one public Instagram carousel and then failed subsequent attempts. That is inconsistent with a permanent device-side CORS, service-worker, or parser defect. It is consistent with intermittent upstream refusal or content-specific login requirements. The Android observations are consistent with the same class of failure, but the exact device error code was not captured.
5. Apple Shortcuts can, in principle, perform the required sequence: a bootstrap `GET`, a fixed GraphQL `POST` with custom headers, a JSON body, and a response body. A macOS simulation verified the exact Instagram sequence: bootstrap `200` with a `csrftoken` in the HTML and `Set-Cookie`, then GraphQL `200` JSON when the request carried both `Cookie: csrftoken=…` and `X-CSRFToken`. A no-cookie CSRF-only request failed with `403`, and a multipart form body failed with `400`. A JSON body with `variables` as a nested object succeeded.
6. **No iOS/iPadOS Shortcut execution occurred.** A signed experimental `.shortcut` was generated and passed a community workflow validator, but it was not imported or run on a real device. Claims about Shortcuts' cookie merging, status/error handling, timeout behavior, caching, and clipboard permissions remain unverified.
7. **Android has no viable zero-install local transport.** The installed PWA Share Target only delivers a URL. Browser Fetch/CORS, opaque `no-cors`, Service Workers, iframes, WebAssembly, WebSocket/WebTransport/WebRTC, JSONP, and form posts do not give an ordinary Web page readable Instagram metadata. Chrome for Android extensions are not a dependable zero-install path. An optional APK or automation app is not zero-install, and the L2A Android runtime remains unverified.

**Verdict: CONDITIONAL GO.**

- **Track A (Apple Shortcuts native HTTP):** CONDITIONAL GO to a real-device experiment. The transport sequence is technically credible and the macOS endpoint behavior is verified, but iOS Shortcuts behavior is not. Do not call it working, reliable, or product-ready.
- **Track B (Android zero-install local transport):** NO-GO. There is no supported browser capability that can read Instagram metadata cross-origin. Keep the hosted Worker for ordinary Android Web/PWA users.
- **Diagnostics/fallback UX:** GO to a small, privacy-safe milestone. The current UI does not expose enough stage information to distinguish a content restriction from a resolver-egress refusal.
- **Productization:** NO-GO until real iPhone and iPad tests pass the checklist in §12 and the import path passes the security review in §8.

The recommended architecture is a **portfolio with a fast path and a fallback**, not a new mandatory app:

```text
All platforms:  PWA + Cloudflare Worker (baseline, fallback, Android, desktop)
iPhone/iPad:    optional Shortcut native transport -> /import (clipboard) -> existing parser
                if native transport fails -> /share?url=... (existing Worker flow)
Android:        PWA + Worker with better stage diagnostics and retry/fallback UX
Desktop:        Chromium Extension v0.3.0 unchanged
Threads:        unchanged
```

The preferred architecture minimizes **user friction × failure rate**, not the amount of local code. A mandatory APK scores worse than the current flow even if its transport is more reliable. A Shortcut that the user already has, with an automatic Worker fallback, is the only candidate that can improve Apple-device reliability without adding an application.

---

## 2. Confirmed mobile failure observations

### 2.1 What the user reported

| Platform            | Observation                                                                                             | What it establishes                                                                                                  | What it does not establish                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Android — vivo X300 | Instagram Posts fail at Resolve. Instagram videos/Reels fail at Resolve.                                | The Share Target and URL entry worked; the failure is in metadata resolution, before preview/download.               | The exact error code, whether the Worker was reached, whether bootstrap or GraphQL failed, or whether the post was content-restricted. |
| iPad                | One Instagram image carousel resolved successfully. Subsequent video and other Resolve attempts failed. | The same device/browser/Worker path can succeed. A permanent CORS, service-worker, parser, or UI defect is unlikely. | Whether the later failures were the same post type, the same network, or the same upstream status.                                     |
| Both                | Errors occur during Resolve, before media preview. Whenever a preview succeeds, downloading succeeds.   | There is no user-observed separate media-download or gallery-save failure in this incident.                          | Whether a future preview could succeed while a specific CDN download fails; that is a different failure class.                         |

The user's low-friction requirement is a product constraint, not a preference: **share post → UniFetch → preview → download**, with no mandatory new app, manual URL copying, or repeated permission prompts.

### 2.2 Production Resolver probes

Two read-only `POST /api/resolve` probes were sent to the production Resolver with `Origin: https://unifetch.pages.dev`. No credentials, cookies, or media were sent. No production configuration or code was changed.

| Probe             | Public input                                         | Production result                                                                                                                               | Interpretation                                                                                                              |
| ----------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Instagram         | `https://www.instagram.com/p/DPCM9i1iTOx/`           | `HTTP 403`, `{"ok":false,"error":{"code":"LOGIN_REQUIRED","message":"Instagram requires login for this content. No login flow is available."}}` | The Worker reached Instagram and returned a typed GraphQL-stage failure. This is not a CORS, Pages-origin, or parser error. |
| Threads (control) | `https://www.threads.com/@threads/post/DNgrJ8UyTAF/` | `HTTP 200`, `ok:true`, `kind:image`, one image asset                                                                                            | The Worker, CORS policy, Pages origin, and general upstream transport were healthy at the same time.                        |

The Instagram error message is the `acquisition.classify` message used for a GraphQL `3xx`/`401`/`403` response (`packages/meta-resolver/src/instagram/acquisition.ts`). It is **not** the bootstrap message (`This profile requires Instagram authentication.`) and **not** the missing-CSRF message (`The public upstream session did not provide the CSRF context required by this profile.`). The production failure therefore occurred at the **GraphQL response**, after a successful bootstrap and session extraction.

The Worker's public response cannot distinguish a `401` from a `403` or a redirect, and cannot distinguish "this specific post requires login" from "Instagram refused this resolver's anonymous request." That distinction is exactly what the current UI hides.

### 2.3 The iPad success is important evidence

The iPad resolved one carousel successfully and then failed. If `unifetch.pages.dev` were blocked by CORS, the service worker served a stale shell, or the parser were broken, the first attempt would not have succeeded. The mixed result is more consistent with:

- Instagram refusing some anonymous requests intermittently from Cloudflare egress;
- Instagram treating some content (for example, a specific video/Reel) as login-required;
- a rate/experiment/egress variation; or
- a transient network failure that the UI classified as `NETWORK_ERROR`.

The current error contract conflates these. L2S cannot honestly choose between them from the user's description alone.

### 2.4 Android is not proven to be a different problem

The vivo X300 reached the Resolve stage, so the Android PWA Share Target worked. The failure is consistent with the same upstream GraphQL-stage refusal. A device-specific Android browser defect is possible but not supported by the evidence:

- Android Chrome's CORS rules are the same class of restriction as any Chromium browser; they would not fail intermittently for the same origin.
- The iPad success demonstrates that the same Web/Worker path can work.
- The production Worker control (Threads) demonstrates that the Worker and CORS path are alive.
- The Android observation does not include the typed error code.

The correct next step is not "build an Android app." It is "capture the stage and code on the device without exposing content," then decide whether the failure is content-specific, egress-dependent, or transport-dependent.

---

## 3. Current Resolve-stage diagnosis

### 3.1 Stage map

The Web/PWA path is:

```text
User URL
  -> parseSupportedUrl / parseInstagramContentRef        (validation)
  -> POST /api/resolve to the Worker                     (transport)
  -> Worker: bootstrap GET instagram.com/                (bootstrap)
  -> Worker: extract csrftoken from Set-Cookie           (session)
  -> Worker: fixed POST /graphql/query                   (GraphQL)
  -> Worker: inspectInstagramGraphql + classify          (classification)
  -> Worker: parseInstagramMediaResponse                 (parsing)
  -> Worker: normalizeInstagramMedia                       (normalization)
  -> Worker: resolverApiResponseSchema                     (schema)
  -> Web: resolverApiResponseSchema + exact URL checks     (client validation)
  -> ResultPanel preview                                   (preview preparation)
  -> WebRuntime download                                   (download, after preview)
```

| Stage                             | Main code                                                       | Current typed outcome                                                                                                                     | Current UI                                                | Diagnostic gap                                                                             |
| --------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1. URL validation                 | `parseSupportedUrl`, `parseInstagramContentRef`                 | `INVALID_URL`, `UNSUPPORTED_PLATFORM`, `UNSUPPORTED_CONTENT`                                                                              | Code displayed; generic title                             | Low. The URL shape is usually enough.                                                      |
| 2. Worker request / transport     | `resolver-client.ts` fetch, 25 s abort                          | `NETWORK_ERROR` for fetch throw, timeout, non-JSON, or unreachable Worker                                                                 | "We couldn't resolve this link" + code                    | CORS, DNS/TLS, timeout, Worker 5xx, and invalid JSON all collapse into one code.           |
| 3. Instagram bootstrap            | `CloudflareMetadataRuntime.prepareOriginSession`                | `LOGIN_REQUIRED` (3xx/401/403), `RATE_LIMITED` (429), `CONTENT_UNAVAILABLE` (404/410), `UNKNOWN`, `NETWORK_ERROR`                         | Generic "This post requires sign-in" for `LOGIN_REQUIRED` | Cannot tell bootstrap login page from GraphQL refusal.                                     |
| 4. Session / CSRF extraction      | same                                                            | `LOGIN_REQUIRED` when `csrftoken` is absent; `UNKNOWN` if `Set-Cookie` cannot be read                                                     | Same generic message                                      | Cannot tell missing CSRF from a real login requirement.                                    |
| 5. GraphQL response               | `CloudflareMetadataRuntime.send`, `classify`                    | `LOGIN_REQUIRED` (3xx/401/403), `RATE_LIMITED`, `CONTENT_UNAVAILABLE`, `GRAPHQL_EXECUTION_ERROR`, `PARSER_OUTDATED` (non-JSON), `UNKNOWN` | Generic "This post requires sign-in" for `LOGIN_REQUIRED` | Cannot tell 401 from 403 from redirect, or content-specific login from egress refusal.     |
| 6. Metadata parsing               | `parseInstagramMediaResponse`                                   | `PARSER_OUTDATED`, `CONTENT_UNAVAILABLE`                                                                                                  | "The platform changed this response"                      | Adequate, but no schema/field detail.                                                      |
| 7. Exact identity / normalization | `normalizeInstagramMedia`, Worker schema, Web client URL checks | `PARSER_OUTDATED` for URL/platform mismatch; `CONTENT_UNAVAILABLE` for no usable media; schema failure for unexpected shape               | Same                                                      | Adequate for a typed failure; no indication which invariant failed.                        |
| 8. Preview preparation            | `ResultPanel`, `WebRuntime`                                     | No metadata Resolve error; download diagnostics after preview                                                                             | Per-asset status after preview                            | Not part of the reported incident. The user says preview success implies download success. |

### 3.2 What the UI actually exposes

The error card displays:

```text
<resolutionErrorTitle(error)>
<resolutionErrorMessage(error)>
<code>{{ error.code }}</code>
```

`apps/web/src/error-messages.ts` has a hard-coded message for `LOGIN_REQUIRED`:

> "This post requires sign-in" / "The platform does not make this content available to anonymous requests. UniFetch’s web resolver does not receive your credentials."

For known codes, `resolutionErrorMessage` returns the hard-coded string and **does not use the Worker's `error.message`**. The Worker's three different `LOGIN_REQUIRED` messages are therefore never shown:

- `This profile requires Instagram authentication.` (bootstrap)
- `The public upstream session did not provide the CSRF context required by this profile.` (CSRF extraction)
- `Instagram requires login for this content. No login flow is available.` (GraphQL)

All three become "This post requires sign-in." That is a concrete, privacy-safe information loss. The code is shown, but the code is not fine-grained enough.

`NETWORK_ERROR` has a similar problem: `resolver-client.ts` maps a thrown fetch, a 25 s abort, a non-JSON response, and an unreachable Worker to the same typed code. A user cannot tell "the Worker is down" from "the browser blocked the response" from "the Worker returned HTML because Cloudflare itself failed."

### 3.3 Minimal privacy-safe diagnostics proposal

Do not change the production contract in L2S. For the next diagnostics milestone, add a **versioned, closed-enum diagnostic block** to the error response:

```jsonc
{
  "ok": false,
  "error": {
    "code": "LOGIN_REQUIRED",
    "message": "Instagram requires login for this content. No login flow is available.",
    "stage": "GRAPHQL_RESPONSE",
    "retryable": true,
    "upstream": {
      "bootstrapStatusClass": "2xx",
      "csrfPresent": true,
      "statusClass": "401",
      "contentTypeClass": "json",
      "redirected": false,
    },
  },
}
```

Rules:

- `stage` is one of a closed enum: `VALIDATION`, `WORKER_TRANSPORT`, `BOOTSTRAP`, `SESSION`, `GRAPHQL_RESPONSE`, `GRAPHQL_CLASSIFICATION`, `PARSER`, `NORMALIZE`, `SCHEMA`.
- `retryable` is a boolean derived from the stage and status class, not a promise.
- `statusClass` is `2xx`, `3xx`, `401`, `403`, `404`, `410`, `429`, `5xx`, or `other`. Do not expose the raw status text.
- `contentTypeClass` is `json`, `html`, `empty`, or `other`.
- `bootstrapStatusClass` and `csrfPresent` are booleans/classes only.
- Never include the URL, query, host path, response body, headers, cookies, tokens, raw messages, or media URLs.
- Version the schema and update both the Worker and the Web client in one change. The existing `resolverApiResponseSchema` is strict; adding fields to the error object without updating the client would be a breaking change.
- The UI should show a **"Diagnostic details"** expansion with the stage, status class, retryable flag, app version, and elapsed time. A "Copy diagnostic" button should copy only those fields, never the URL or content.
- The Worker already has an internal `DiagnosticStage`/`DiagnosticRecord` observer (`apps/resolver-worker/src/diagnostics.ts`) and a local-only `dev-diagnostic.ts`. Reuse those stage names rather than inventing a second vocabulary.

A short-term, lower-risk improvement is possible without a schema change: make `resolutionErrorMessage` show the Worker's safe generated message for `LOGIN_REQUIRED` instead of the hard-coded generic message. That would at least distinguish bootstrap, CSRF, and GraphQL. It still would not distinguish a content-specific login requirement from a resolver-egress refusal. A `stage` field is the correct fix.

### 3.4 What can and cannot be concluded

| Claim                                                                     | Status  | Basis                                                                                                        |
| ------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------ |
| The production failure is at Resolve, before preview.                     | **[E]** | User report; typed Worker response; no preview was shown.                                                    |
| The production Worker reached Instagram.                                  | **[E]** | It returned a typed `LOGIN_REQUIRED` GraphQL-stage message, not a `NETWORK_ERROR`.                           |
| The failure is at the GraphQL response, not bootstrap or CSRF extraction. | **[E]** | The message is the `acquisition.classify` GraphQL message, not the bootstrap/CSRF messages.                  |
| The public sample is accessible from a non-Cloudflare network.            | **[E]** | The same sample returned `200` JSON from this macOS network with the anonymous CSRF cookie and header.       |
| The mechanism is Cloudflare egress IP/ASN/TLS reputation.                 | **[P]** | The strongest remaining hypothesis after ruling out the code, jar values, and parser. Not proven.            |
| The user's Android/iPad failures are the same mechanism.                  | **[P]** | Consistent with intermittent upstream refusal; exact device codes were not captured.                         |
| The current UI exposes enough stage information.                          | **[X]** | It discards the Worker's stage-specific messages and shows a generic code/message.                           |
| A Shortcut will fix the failure.                                          | **[P]** | Device egress may avoid the refusal, but this is unverified on iOS and can be defeated by Private Relay/VPN. |

---

## 4. iOS Shortcuts HTTP capability matrix

### 4.1 Documented action capabilities

Apple's Shortcuts User Guide documents **Get Contents of URL** as the action that makes an API request. It supports `GET`, `POST`, `PUT`, `PATCH`, and `DELETE`; when the method is `POST`/`PUT`/`PATCH`, a **Request Body** is available as **JSON**, **Form**, or **File**. The action has a **Headers** section with **+ Add new header**. The official guide does not document cookie storage, redirect control, timeouts, response status codes, or response-header access.

| Capability                                                              | Stock Shortcuts                                         | Evidence                                                                                  | Notes                                                                                                                                                                                                          |
| ----------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET` / `POST` / `PUT` / `PATCH` / `DELETE`                             | Yes                                                     | **[D]** Apple Shortcuts User Guide, “Request your first API”                              | The action is `is.workflow.actions.downloadurl`.                                                                                                                                                               |
| Custom request headers                                                  | Yes                                                     | **[D]** Apple guide + action documentation                                                | Key/value headers; arbitrary names are accepted in practice.                                                                                                                                                   |
| `User-Agent` header                                                     | Yes                                                     | **[P]** community reports and generated shortcuts                                         | A fixed UA is a compatibility header; do not randomize or rotate.                                                                                                                                              |
| `Cookie` header                                                         | Very likely                                             | **[P]** maintained third-party Shortcut uses a `Cookie` header for media/session requests | URLSession may merge it with its own cookie jar; duplicate-cookie behavior is unverified.                                                                                                                      |
| Automatic cookie sharing between multiple `Get Contents of URL` actions | Reported within one run                                 | **[P]** Automators Talk tip                                                               | Not in Apple's official guide. Separate-run persistence is unverified.                                                                                                                                         |
| Read `Set-Cookie` from a response                                       | Not from `Get Contents of URL`                          | **[D]/[P]**                                                                               | Use **Get Headers of URL** (`is.workflow.actions.url.getheaders`, a HEAD request) or parse the HTML body. Community evidence says the HEAD headers dictionary exposes `Set-Cookie`; not officially documented. |
| JSON request body                                                       | Yes                                                     | **[D]** Apple guide                                                                       | `WFJSONValues`; nested dictionaries are possible but the UI can render them inconsistently.                                                                                                                    |
| Form request body                                                       | Yes, but multipart-oriented                             | **[D]** Apple guide; **[E]** Instagram rejected multipart with `400`                      | Apple describes Form as the multipart body type when files are added. Do not rely on it for `application/x-www-form-urlencoded` unless the exact OS build is tested.                                           |
| File request body                                                       | Yes                                                     | **[D]** Apple guide                                                                       | Use a JSON **Text** action as `WFRequestVariable` with `Content-Type: application/json`; this is the documented fallback for nested JSON.                                                                      |
| Response body                                                           | Yes, as a file/text                                     | **[D]/[P]**                                                                               | Convert with **Get Text from Input** (`is.workflow.actions.detect.text`).                                                                                                                                      |
| Response status code                                                    | No                                                      | **[D]** stock action returns the body, not status metadata                                | The third-party **Actions** app's “Get Contents of URL (Extended)” adds status/headers/timeout, but that is an extra app install.                                                                              |
| Response headers                                                        | Only via a separate **Get Headers of URL** HEAD request | **[P]**                                                                                   | The HEAD request may have different server behavior than the POST; do not assume it returns the same cookies.                                                                                                  |
| Redirect control                                                        | No manual control                                       | **[P]**                                                                                   | The action follows redirects; a login redirect becomes an HTML body, not a typed status.                                                                                                                       |
| Timeout control                                                         | No stock setting                                        | **[D]** third-party extended action adds timeout                                          | Stock behavior is an OS/URLSession default; not controllable in the shortcut.                                                                                                                                  |
| Request/response size limit                                             | Undocumented practical limit                            | **[P]**                                                                                   | Our simulation handled a 501 KB HTML bootstrap and a 22 KB JSON response; iOS Shortcuts memory limits are unverified.                                                                                          |
| CORS                                                                    | Not applicable to the native request                    | **[D]/[P]**                                                                               | CORS is a browser-enforced policy. Shortcuts is a native app using URLSession, not a Web page. This is an architectural inference, not a “CORS bypass” feature.                                                |
| HTTPS / ATS                                                             | Yes, ATS applies                                        | **[D]**                                                                                   | Instagram is HTTPS; no cleartext exception is needed.                                                                                                                                                          |
| Regex / text parsing                                                    | Yes                                                     | **[D]**                                                                                   | **Match Text** + **Get Group from Matched Text**.                                                                                                                                                              |
| Base64                                                                  | Yes                                                     | **[D]**                                                                                   | **Base64 Encode**; useful only if a binary handoff is ever needed.                                                                                                                                             |
| Clipboard                                                               | Yes                                                     | **[D]**                                                                                   | **Set Clipboard** / **Get Clipboard**.                                                                                                                                                                         |
| Open URL                                                                | Yes                                                     | **[D]**                                                                                   | Opens the default browser, not necessarily the installed home-screen PWA.                                                                                                                                      |
| Error handling                                                          | No try/catch                                            | **[D]/[P]**                                                                               | A failed action stops the shortcut; there is no built-in branch on HTTP status.                                                                                                                                |
| Background HTTP before opening a browser                                | Yes in normal conditions                                | **[P]**                                                                                   | The shortcut can run its HTTP actions before **Open URL**; iOS suspension and low-power behavior are unverified.                                                                                               |
| iPhone vs iPad                                                          | Same action set                                         | **[D]**                                                                                   | Share-sheet presentation, default browser, and multitasking differ.                                                                                                                                            |
| Safari vs installed Web App                                             | `Open URL` uses the default browser                     | **[P]**                                                                                   | There is no documented way for a Shortcut to target a specific installed PWA.                                                                                                                                  |

### 4.2 The exact Instagram sequence required

The existing Worker profile is fixed (`packages/meta-resolver/src/instagram/endpoint-profile.ts`):

- Endpoint: `https://www.instagram.com/graphql/query`
- Method: `POST`
- App ID: `936619743392459`
- `doc_id`: `27128499623469141`
- `X-CSRFToken` header
- Form fields: `variables`, `doc_id`, `server_timestamps`

The Shortcut experiment uses the same profile but a JSON body:

```text
1. GET https://www.instagram.com/
   Headers: Accept, Accept-Language, User-Agent, Cache-Control: no-cache, Pragma: no-cache
   -> 200 HTML containing "csrf_token":"<token>"
   -> Set-Cookie: csrftoken=<token>

2. POST https://www.instagram.com/graphql/query
   Headers:
     Accept: */*
     Accept-Language: en-US,en;q=0.8
     Content-Type: application/json
     X-IG-App-ID: 936619743392459
     Referer: https://www.instagram.com/
     User-Agent: <fixed desktop Chrome UA>
     X-CSRFToken: <token>
     Cookie: csrftoken=<token>
   Body:
     {
       "doc_id": "27128499623469141",
       "variables": {
         "shortcode": "<shortcode>",
         "__relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider": false
       },
       "server_timestamps": "true"
     }
   -> 200 JSON with data.xdt_api__v1__media__shortcode__web_info.items
```

The important corrections to the L2A narrative:

- L2A observed one successful GraphQL request with only `X-CSRFToken` and no `Cookie` header. In this L2S simulation, the same no-cookie shape returned `403` HTML. The cookie is now required in the tested environment.
- The production Worker already sends an anonymous cookie jar. Its failure is therefore not explained by the absence of a cookie.
- A multipart form body is rejected. Shortcuts' **Form** body is not safe for this endpoint unless a specific OS build is proven to send `application/x-www-form-urlencoded`.
- A JSON body with `variables` as an object is accepted, which makes a stock Shortcuts JSON body feasible.

### 4.3 macOS HTTP simulation results

All requests were public-only, unauthenticated, and made from this macOS host. No account cookies, login, media download, retries, proxy rotation, CAPTCHA solving, or fingerprint spoofing were used. The sample was the public single-image post `DPCM9i1iTOx` used by L2A.

| #   | Request                                                                                                                          | Result                                                                                                                | What it establishes                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `GET https://www.instagram.com/` with an iPhone Safari UA                                                                        | `200`, 501,534 bytes, one `Set-Cookie: csrftoken=…`, HTML contains `"csrf_token":"…"`; HTML token equals cookie token | Shortcuts can obtain the token from the public HTML or `Set-Cookie`; no account session is needed. |
| 2   | `HEAD https://www.instagram.com/` with the iPhone UA                                                                             | `200`, `Set-Cookie: csrftoken=…`                                                                                      | A `Get Headers of URL` variant is plausible, but not required.                                     |
| 3   | GraphQL form POST, token only, iPhone UA                                                                                         | `403` HTML                                                                                                            | CSRF token without cookie is insufficient in this environment.                                     |
| 4   | GraphQL form POST, token only, desktop Chrome UA                                                                                 | `403` HTML                                                                                                            | The failure is not just the mobile UA.                                                             |
| 5   | GraphQL form POST, cookie + `X-CSRFToken`                                                                                        | `200` JSON, 22,419 bytes, media root present                                                                          | The required pair is cookie + header.                                                              |
| 6   | GraphQL form POST, iPhone UA + cookie + `X-CSRFToken`                                                                            | `200` JSON, 23,228 bytes                                                                                              | A mobile UA is acceptable when the cookie/header are present.                                      |
| 7   | GraphQL multipart form POST, cookie + `X-CSRFToken`                                                                              | `400` JSON `invalid request`                                                                                          | Do not use multipart Form for this endpoint.                                                       |
| 8   | GraphQL JSON POST, `variables` as a JSON string, cookie + `X-CSRFToken`                                                          | `200` JSON, 22,419 bytes                                                                                              | JSON body works.                                                                                   |
| 9   | GraphQL JSON POST, `variables` as an object, cookie + `X-CSRFToken`                                                              | `200` JSON, 22,419 bytes                                                                                              | Shortcuts can build a nested dictionary, not just a string.                                        |
| 10  | GraphQL form POST with the production-like anonymous jar (`csrftoken`, empty `mid`, `ig_pr`, `ig_vw`, `s_network`, `ds_user_id`) | `200` JSON                                                                                                            | The empty jar values are not the cause on this network.                                            |
| 11  | GraphQL form POST with cookie but no `X-CSRFToken`                                                                               | `403` HTML                                                                                                            | The header is also required.                                                                       |
| 12  | `GET https://www.instagram.com/p/DPCM9i1iTOx/embed/captioned/`                                                                   | `200` HTML, 25 CDN references, **no `Access-Control-Allow-Origin`**, `X-Frame-Options: DENY`                          | The embed page is not a browser-readable CORS fallback.                                            |

Request volume: one bootstrap GET, one HEAD, one embed GET, and nine fixed GraphQL POSTs, plus two production Worker probes. No loops, no enumeration, no retries, no media downloads. This is a small diagnostic set, not a reliability study.

### 4.4 What remains unverified on iOS/iPadOS

| Question                                                                                                        | Status  | Why it matters                                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| Does iOS Shortcuts accept a manually set `Cookie` header?                                                       | **[P]** | If it rejects or overrides it, the GraphQL POST will `403`.                                    |
| Does Shortcuts merge its cookie jar with a manually set `Cookie` header, creating duplicate `csrftoken` values? | **[P]** | Duplicate cookies can fail CSRF validation. Test both explicit-cookie and shared-jar variants. |
| Do cookies from the bootstrap persist to the POST in the same run?                                              | **[P]** | Community evidence says yes; Apple does not document it.                                       |
| Do cookies persist between separate runs?                                                                       | **[P]** | A stale token could cause intermittent failures.                                               |
| Does `Get Contents of URL` honor `Cache-Control: no-cache` for the bootstrap?                                   | **[P]** | A cached HTML page could carry an expired token.                                               |
| Does the JSON **File** body pattern send the exact bytes with `Content-Type: application/json`?                 | **[P]** | The plugin guidance says yes; iOS UI behavior varies by version.                               |
| Does `Get Contents of URL` return a `401`/`403` body or throw?                                                  | **[P]** | The shortcut's only fallback is "body begins with `{`."                                        |
| Can the shortcut set a browser-like `User-Agent`?                                                               | **[P]** | Community reports say yes; if not, Instagram may serve a different page.                       |
| Does iCloud Private Relay change the egress enough to reproduce the Worker refusal?                             | **[P]** | This is a direct threat to the egress hypothesis. Test with Private Relay on and off.          |
| Does `Open URL` open Safari or the installed PWA?                                                               | **[P]** | The existing docs already warn Safari may open instead of the PWA.                             |
| Does clipboard read work in Safari/PWA with one tap, and what prompt appears?                                   | **[P]** | iOS permission behavior is the main UX risk.                                                   |
| Does a large carousel JSON fit in memory/time on older devices?                                                 | **[P]** | The clipboard avoids URL length limits but not memory limits.                                  |
| Does iPad share-sheet/multitasking change the flow?                                                             | **[P]** | Test both iPhone and iPad.                                                                     |

**Do not claim iOS viability without real Shortcuts execution.** The signed artifact in §11 is a test vehicle, not evidence.

---

## 5. Android Web/PWA capability matrix

### 5.1 What the installed PWA can and cannot do

| Mechanism                                                   | Available in Android Chrome/PWA? | Can read Instagram metadata?             | Evidence / reason                                                                                                                                           |
| ----------------------------------------------------------- | -------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web Share Target                                            | Yes, installed PWA (WebAPK)      | No; it only receives the shared URL/text | **[D]** MDN `share_target`; current manifest at `apps/web/vite.config.ts`.                                                                                  |
| Ordinary `fetch` (`mode: cors`)                             | Yes                              | No                                       | Instagram does not grant `unifetch.pages.dev` an `Access-Control-Allow-Origin`; the browser blocks the response. **[D]**                                    |
| `fetch` (`mode: no-cors`)                                   | Yes                              | No                                       | The response is opaque; status/body are unreadable. **[D]**                                                                                                 |
| `XMLHttpRequest`                                            | Yes                              | No                                       | Same CORS/SOP rules. **[D]**                                                                                                                                |
| Service Worker                                              | Yes                              | No                                       | A service worker controls only its own origin/scope; it cannot read another origin's response. **[D]**                                                      |
| `iframe`                                                    | Yes                              | No                                       | Cross-origin DOM access is blocked; `postMessage` requires Instagram cooperation. **[D]**                                                                   |
| WebAssembly                                                 | Yes                              | No                                       | WASM has no network privileges beyond the host's Fetch/XHR; it cannot bypass CORS. **[D]**                                                                  |
| WebSocket                                                   | Yes                              | No practical path                        | A WebSocket connection is not a general HTTP metadata transport; Instagram exposes no public metadata WebSocket. **[D]/[P]**                                |
| WebTransport                                                | Yes in modern Chrome             | No                                       | Requires a server that speaks WebTransport; Instagram does not expose one. **[D]/[P]**                                                                      |
| WebRTC data channel                                         | Yes                              | No                                       | Requires signaling and a peer; it is not an HTTP client. **[D]**                                                                                            |
| Hidden form POST / iframe navigation                        | Yes                              | No                                       | The response replaces/loads a cross-origin document; the parent cannot read it. **[D]**                                                                     |
| JSONP / `<script src>`                                      | Yes                              | No                                       | Instagram does not serve a JSONP metadata endpoint. **[D]/[P]**                                                                                             |
| `<img>` / `<video>`                                         | Yes                              | Media only                               | Can load media bytes, not post structure, caption, or asset list. **[D]**                                                                                   |
| `sendBeacon`                                                | Yes                              | No                                       | Fire-and-forget; no readable response. **[D]**                                                                                                              |
| `EventSource`                                               | Yes                              | No                                       | Subject to CORS and requires an SSE endpoint. **[D]**                                                                                                       |
| Credential Management / FedCM                               | Yes                              | No                                       | No Instagram federated credential or CORS grant for this use. **[D]/[P]**                                                                                   |
| Storage Access API                                          | Yes                              | No                                       | It can request third-party cookie access in some embedded contexts, but CORS still blocks reading the response. **[D]**                                     |
| Trusted Web Activity                                        | Yes, inside an app               | Only with native app code                | TWA is still a browser surface; a native HTTP bridge requires an APK. **[D]**                                                                               |
| Android WebView                                             | Only inside an app               | Only with app code                       | A PWA cannot instantiate a WebView with a JavaScript bridge. **[D]**                                                                                        |
| Chrome extensions                                           | Not dependable on Android Chrome | No                                       | Chrome for Android does not support the desktop extension model; alternative browsers that do are an extra install and not a zero-install path. **[D]/[P]** |
| Optional native APK                                         | Yes, sideload                    | Yes, via native HTTP                     | L2A desktop proof only; Android runtime **NOT VERIFIED**; no share intent/MediaStore yet. **[E]/[P]**                                                       |
| Automation app (Tasker, HTTP Shortcuts, Termux, MacroDroid) | Optional install                 | Yes, via native HTTP/script              | Adds an app, setup, permissions, and a handoff problem. Not zero-install. **[P]**                                                                           |
| Public CORS proxy                                           | Yes                              | Yes, technically                         | Rejected: privacy, security, reliability, abuse, and terms risk. **[X]**                                                                                    |
| Multi-egress Worker / relay                                 | Yes, server-side                 | Yes                                      | Not local; invisible to users; a possible reliability improvement for Android. **[P]**                                                                      |

### 5.2 Explicitly rejected approaches

The following are rejected because they repackage the same browser restrictions without changing the security model:

- **WASM “native” HTTP.** Wasm has no sockets or cross-origin privileges; a Wasm fetch is still the browser's fetch.
- **Service Worker proxy.** It can only intercept its own origin; it cannot read Instagram's response.
- **Hidden iframe / form POST.** The response is cross-origin and unreadable. `postMessage` requires Instagram to cooperate.
- **`no-cors` + opaque response.** The body is unreadable by design.
- **`window.open` + DOM reading.** Cross-origin window/document access is blocked.
- **JSONP / `<script>` injection.** Instagram does not provide a JSONP metadata endpoint.
- **WebSocket/WebTransport/WebRTC as a generic HTTP tunnel.** They require a cooperating server and are not a browser loophole.
- **Public CORS proxies.** They add a third party that sees the URL and metadata, break reliability, and create abuse/terms risk.
- **Chrome Android extension / alternative browser.** Not zero-install, not the user's default browser, and not a dependable product path.

**Track B conclusion:** Android has **no zero-install local transport** that can read Instagram metadata. The hosted Worker remains necessary for ordinary users. The only honest improvements are (a) better diagnostics/fallback UX, (b) a server-side egress-redundancy experiment, or (c) an optional native helper that is explicitly not mandatory.

### 5.3 Optional Android helper analysis

The L2A Tauri PoC is the only existing native HTTP implementation. Its constraints are material:

- Android runtime is **BUILD-ONLY**, not verified.
- No Android share intent, MediaStore/gallery export, background download, or foreground service.
- iOS distribution is out; Android APK sideload is viable but adds install friction and signing/update burden.
- The APK is app-private storage only; a user cannot find the file in the gallery yet.
- The PoC is not part of the production pnpm workspace and is not a product.

An optional APK can be offered later to power users, but it cannot be the default answer to this incident. A mandatory APK is a product regression relative to the user's stated low-friction requirement.

---

## 6. Data handoff design from Shortcut to Web

### 6.1 Requirements

1. Transfer only the bounded, public metadata needed for preview.
2. Do not send metadata to UniFetch infrastructure.
3. Reuse the existing TypeScript Instagram parser; do not duplicate parsing logic in Shortcuts.
4. Preserve exact-post identity (shortcode and canonical URL).
5. Avoid a mandatory second app, manual URL copying, or repeated permission prompts.
6. Keep the existing Worker flow as an automatic fallback.
7. Be safe when the clipboard or fragment is tampered with.

### 6.2 Recommended design: clipboard + canonical-URL fragment

```text
Shortcut (on device)
  ├─ validate shared URL and extract shortcode
  ├─ bootstrap GET -> csrftoken
  ├─ GraphQL POST -> raw public JSON
  ├─ Set Clipboard = raw JSON
  └─ Open URL https://unifetch.pages.dev/import#url=<encoded canonical URL>

Safari / default browser
  └─ /import
       ├─ read #url, validate Instagram URL, scrub the fragment
       ├─ show "Import from Shortcut" button
       └─ on tap:
            navigator.clipboard.readText()
            size cap -> JSON.parse
            verify items[0].code === shortcode
            parseInstagramMediaResponse(raw, shortcode)
            normalizeInstagramMedia(media, canonicalUrl)
            verify asset URLs are HTTPS and on an Instagram CDN allowlist
            render the existing ResultPanel preview/download
```

Why this split:

- The **fragment contains only the public canonical URL**, not metadata. It is short, not sent to the static host, and is scrubbed with `history.replaceState` before any resolution.
- The **clipboard contains the raw public JSON**. It has no practical URL-length limit, so carousels/videos do not hit Safari's URL limit.
- The Web app **reuses the parser**; Shortcuts only transports bytes.
- No metadata is uploaded to a UniFetch endpoint.
- The existing `/share?url=...` Worker flow remains the fallback when the native POST does not return JSON.

### 6.3 `/import` contract (for the next milestone)

The route is **not implemented in L2S**. The contract is:

```ts
interface ImportEnvelopeV1 {
  v: 1;
  platform: 'instagram';
  canonicalUrl: string; // from #url, validated with parseInstagramContentRef
  raw: unknown; // public GraphQL JSON, size-capped
}
```

Validation order:

1. Parse `location.hash`; accept only `#url=<encoded>`.
2. Validate the URL with `parseInstagramContentRef`; reject non-Instagram, non-post/Reel, credentials, or non-HTTPS.
3. `history.replaceState` to remove the fragment before any async work.
4. On user gesture, read the clipboard; reject empty or over the size cap (for example 2 MiB).
5. `JSON.parse`; reject non-object or missing `data.xdt_api__v1__media__shortcode__web_info.items`.
6. Verify the raw item's `code` equals the expected shortcode. The existing parser intentionally treats the supplied shortcode as authoritative and ignores the raw `code`; for an untrusted handoff, that is not enough.
7. Call `parseInstagramMediaResponse(raw, shortcode)` and `normalizeInstagramMedia(media, canonicalUrl)`.
8. Restrict asset URLs to HTTPS on `*.cdninstagram.com` and `*.fbcdn.net` (reuse the L2A native allowlist), or a stricter allowlist. Do not let a clipboard payload point the browser at an arbitrary origin.
9. Reject raw HTML, data URLs, credentials in URLs, non-HTTPS URLs, and oversized payloads.
10. Show a typed error with a "Try the standard resolver" link on failure; do not render raw payload text.
11. Clear the clipboard after import if the browser permits it; otherwise show a "Clear clipboard" action.

Exact identity is the critical invariant. The current parser's comment says “The supplied shortcode is authoritative; raw code is ignored.” That is appropriate when the acquisition adapter requested the exact shortcode. It is **not** sufficient when the JSON comes from the clipboard, because a tampered or stale clipboard could contain a different post. The import route must add the raw-code check (or the parser must gain an `expectedRawCode` option) before normalizing.

### 6.4 Handoff alternatives compared

| Mechanism                          | Extra taps                   | Size limit                                                         | Privacy                                                                  | Reliability                                           | Verdict                                                         |
| ---------------------------------- | ---------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------- |
| Full metadata in `#fragment`       | 0                            | iOS Safari URL limit (commonly cited around 80,000 chars; **[P]**) | Metadata in browser history/address bar until scrubbed; not sent to host | Fails for large carousels/videos                      | Reject as the primary path; keep only a canonical-URL fragment. |
| Full metadata in `?query`          | 0                            | Host/proxy limits                                                  | Metadata is sent to the static host and may be logged                    | Works for small payloads                              | Reject. Violates the no-metadata-to-server goal.                |
| Clipboard + canonical-URL fragment | 1 tap, possible paste prompt | Large (browser memory)                                             | Metadata in the system clipboard, readable by other apps; no server      | Best practical reliability                            | **Recommended.**                                                |
| Temporary file + file picker       | 2–4 taps                     | Large                                                              | File in app/iCloud storage; user must pick                               | High but slow                                         | Reject for low friction.                                        |
| Custom URL scheme                  | 0                            | N/A                                                                | N/A                                                                      | N/A                                                   | PWA cannot register a custom scheme without a native app.       |
| Universal link / associated domain | 0                            | N/A                                                                | N/A                                                                      | N/A                                                   | Requires a native app and associated domains.                   |
| Run JavaScript on Webpage          | 0–1, permission prompts      | Large                                                              | Metadata in a Safari JS bridge                                           | Requires an open Safari tab and user setting; brittle | Not recommended.                                                |
| POST metadata to UniFetch          | 0                            | Large                                                              | Metadata leaves the device; new server surface                           | High                                                  | Reject. Violates the privacy model.                             |
| iCloud/CloudKit handoff            | 2+                           | Large                                                              | Metadata in iCloud; identity/account surface                             | Medium                                                | Reject. Adds storage and account coupling.                      |

### 6.5 Why not duplicate the parser in Shortcuts

Shortcuts can extract a few dictionary values, but the Instagram response is nested and includes carousel arrays, image/video candidates, dimensions, thumbnails, captions, and timestamps. Reimplementing the parser in Shortcuts would:

- diverge from `packages/meta-resolver/src/instagram/parser.ts` and `normalize.ts`;
- make every profile change a two-place change;
- lose the existing defensive schema/identity tests;
- make carousel ordering and candidate selection fragile;
- make it harder to audit what is sent to the Web UI.

Passing the raw JSON to the existing TypeScript parser is smaller, safer, and preserves a single source of truth. The only parser change needed is the import-specific raw-code/CDN validation described above.

### 6.6 Carousel and video size

A single-image response was 22,419 bytes in the simulation. A carousel or video response can be larger. The clipboard path avoids URL-length limits; the `/import` route should cap the payload (for example 2 MiB) and reject anything larger. The Shortcut should not try to compress or truncate the JSON: truncation would corrupt the parser input, and compression would add a decompressor dependency to the Web app. If a payload is too large, the Web page should show a typed "too large" error and offer the Worker fallback.

---

## 7. UX friction comparison

### 7.1 Candidates

| Candidate                                                          | One-time setup                         | Daily share-to-download steps                                                                                                                                                         | Expected reliability                                                                  | Privacy/auth boundary                                                                       | Platform coverage          | Maintenance                                                          | Complexity                                                    | Distribution/review                                                     |
| ------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **A. Current Web/PWA + Cloudflare Worker**                         | Install PWA (Android) / Shortcut (iOS) | Share → UniFetch → auto Resolve → Preview → Download (0 extra taps)                                                                                                                   | Instagram upstream-dependent; production currently fails at GraphQL; Threads works    | URL to Worker; no credentials; media direct                                                 | Android, iOS, desktop Web  | Medium: unstable Instagram profile, egress reputation, CORS          | Existing                                                      | Pages + Worker                                                          |
| **B. iOS Shortcut native HTTP + Web parser**                       | Add/update one Shortcut (no new app)   | Share → Shortcut runs GET+POST → Safari opens `/import` → tap Import (clipboard) → Preview → Download (1 extra tap, possible paste prompt; 0 if a small fragment path is added later) | Device egress may avoid the Worker refusal; unverified; same doc_id/profile fragility | No account cookies; anonymous CSRF only; metadata stays on device; Instagram sees device IP | iPhone/iPad only           | Medium: Shortcut source, iOS behavior, profile changes, import route | Medium: plist generation, clipboard, parser reuse, validation | iCloud/signed `.shortcut`; no App Store review; users must trust/import |
| **C. Android Web/PWA + Worker with improved diagnostics/fallback** | Same as A                              | Same as A, plus a clearer error and a Retry/Open original action                                                                                                                      | Unchanged upstream reliability; better explainability                                 | Same as A                                                                                   | Android, iOS, desktop Web  | Low                                                                  | Low                                                           | Same as A                                                               |
| **D. Optional Android Tauri native shell**                         | Sideload APK, permissions, updates     | Share → app → resolve → app-private save (no gallery yet)                                                                                                                             | L2A desktop success; Android runtime unverified; single sample                        | Local native HTTP; no credentials; APK trust surface                                        | Android (desktop optional) | High: Rust/Tauri, Android toolchain, signing, updates                | High                                                          | GitHub Releases APK; sideload warnings; Play policy risk                |
| **E. Zero-install alternative**                                    | None found                             | None found                                                                                                                                                                            | N/A                                                                                   | N/A                                                                                         | N/A                        | N/A                                                                  | N/A                                                           | N/A                                                                     |

### 7.2 Friction × failure-rate score

Scores are qualitative: **friction** 1 = lowest, 5 = highest; **failure risk** 1 = lowest, 5 = highest. The product score is a decision aid, not a measurement.

| Candidate                             | Friction | Failure risk | Friction × failure risk | Interpretation                                                                            |
| ------------------------------------- | -------- | ------------ | ----------------------- | ----------------------------------------------------------------------------------------- |
| A. Current PWA + Worker               | 1        | 4            | 4                       | Lowest friction, but the current Instagram failure rate is high.                          |
| B. iOS Shortcut + Web parser          | 2        | 2–3          | 4–6                     | One extra tap, but potentially much better Apple-device reliability. Worth a device test. |
| C. Android PWA + Worker + diagnostics | 1        | 4            | 4                       | Same reliability, better user understanding and retry behavior. Low-risk complement.      |
| D. Optional Android APK               | 4        | 2–3          | 8–12                    | Best potential transport reliability, worst friction. Not a default answer.               |
| E. Zero-install alternative           | —        | —            | —                       | No viable candidate.                                                                      |

The product conclusion is not "local execution is always better." It is:

- **Apple:** a Shortcut the user already has, with an automatic Worker fallback, can improve reliability at one extra tap. That is a credible product trade-off.
- **Android:** there is no zero-install local transport. A mandatory APK is a large friction increase for an unverified reliability gain. The honest path is Worker + diagnostics/fallback, with an optional APK only for power users later.
- **Diagnostics:** improving the error stage is low risk and helps every platform. It does not fix the upstream refusal, but it stops misleading users and gives maintainers actionable evidence.

### 7.3 Recommended daily journeys

**iPhone/iPad (recommended experiment):**

```text
Instagram → Share → UniFetch L2S (Shortcut)
  → native bootstrap + GraphQL (1–3 s, no tab yet)
  → if JSON: Safari opens UniFetch /import → tap Import → preview → download
  → if not JSON: Safari opens /share?url=... → existing Worker flow
```

**Android (recommended now):**

```text
Instagram → Share → UniFetch PWA
  → Worker resolve → preview → download
  → on failure: stage-aware message + Retry + Open original
```

**Android (optional future, not default):**

```text
Install optional UniFetch APK → share → native resolve → save
```

The optional APK must not be required for the ordinary journey.

---

## 8. Security and privacy implications

### 8.1 Trust boundaries

| Component     | Sees                                                                                           | Does not see                                                                | Boundary                                   |
| ------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| Shortcut      | Shared URL, public bootstrap HTML, anonymous `csrftoken`, public GraphQL JSON, clipboard write | Instagram password, `sessionid`, `ds_user_id`, account cookies, media bytes | Device-local; no UniFetch server           |
| Web `/import` | Canonical URL in fragment, clipboard JSON, user gesture                                        | Account cookies, Worker credentials, raw upstream headers                   | Browser origin `unifetch.pages.dev`; HTTPS |
| Worker        | Public URL, transient upstream metadata                                                        | User credentials, clipboard, media bytes                                    | Cloudflare egress; existing contract       |
| Instagram     | Device IP (Shortcut) or Cloudflare IP (Worker), anonymous CSRF, fixed public query             | UniFetch account (none), user password (never sent)                         | Upstream platform                          |
| CDN           | Media request from the browser/device                                                          | UniFetch Worker (media is direct)                                           | Existing media path                        |

### 8.2 Shortcut-specific security

- The Shortcut handles **no account credentials**. It does not read `sessionid`, `ds_user_id`, `Authorization`, or any browser cookie store.
- The `csrftoken` is an anonymous CSRF token from the public bootstrap. It must remain in memory and must not be copied, logged, shown in an alert, or sent to UniFetch. The generated Shortcut does not display it.
- The generated Shortcut sends only one bootstrap GET and one fixed GraphQL POST per shared URL. It has no loop, retry-for-evasion, proxy rotation, CAPTCHA solving, or randomized fingerprint.
- The `User-Agent` is a fixed ordinary desktop Chrome string. It is a compatibility header to receive the public HTML, not a TLS/JA3 spoof or an anti-bot bypass. Do not randomize it.
- The Shortcut must not add “log in to Instagram,” “open in Instagram,” “export cookies,” “use my session,” or “solve challenge” steps. If the public request fails, it falls back to the Worker; it does not escalate to credentials.
- The Shortcut should show only generic alerts. It must not show the raw HTML, JSON, token, or media URLs.
- Distribution: a signed `.shortcut` with `--mode anyone` can be imported by a tester. The recipient should review the actions before running. The project does not control iCloud link availability or Apple's Shortcuts behavior.
- The Shortcut is not an App Store app, so App Review 5.2.3 is not the distribution gate. Instagram's terms and Apple's Shortcuts ecosystem rules still apply; legal review is required before a public release.

### 8.3 Import-route threats and mitigations

The clipboard and fragment are **untrusted input**. Treat them like any other user-supplied data.

| Threat                                             | Impact                                                                                         | Mitigation                                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clipboard tampering / stale JSON from another post | Wrong media shown under the expected shortcode; user confusion                                 | Verify `items[0].code === expectedShortcode`; reject mismatch. Do not rely on the parser's “supplied shortcode is authoritative” behavior for import. |
| Arbitrary asset URL in JSON                        | Browser fetches an attacker-chosen URL; possible tracking/SSRF-like behavior; unexpected media | HTTPS-only; allowlist `*.cdninstagram.com` and `*.fbcdn.net` (or stricter); reject credentials, data URLs, and non-HTTPS.                             |
| Oversized payload                                  | Memory/CPU exhaustion; UI freeze                                                               | Size cap (for example 2 MiB); reject before `JSON.parse`.                                                                                             |
| HTML/JSON injection                                | XSS or misleading UI                                                                           | Never render raw payload text; use the typed parser and Vue text interpolation; no `v-html`.                                                          |
| Malformed media schema                             | Parser crash or partial asset list                                                             | Existing `PARSER_OUTDATED`/`CONTENT_UNAVAILABLE` fail-closed behavior.                                                                                |
| Fragment leakage                                   | Public canonical URL in history                                                                | Fragment contains only the public URL; `history.replaceState` before async work.                                                                      |
| Clipboard persistence                              | Other apps or clipboard history read the JSON                                                  | Offer “Clear clipboard”; instruct the user; do not put the JSON in a notification or file.                                                            |
| Open redirect / non-Instagram URL                  | Phishing or unintended navigation                                                              | `parseInstagramContentRef` exact host/path validation; no arbitrary URL open.                                                                         |
| Worker fallback loop                               | Repeated requests                                                                              | One fallback navigation; no automatic retry loop in the Shortcut.                                                                                     |
| Private Relay / VPN                                | Different egress, unexpected upstream refusal                                                  | Record in diagnostics; do not attempt to bypass.                                                                                                      |

### 8.4 Handoff privacy

- **Clipboard:** the public JSON contains captions, usernames, and signed CDN URLs. The system clipboard is shared across apps and may be synced by Universal Clipboard. This is a real privacy consideration, not a theoretical one. The user should clear the clipboard after import; the Web page should offer that action.
- **Fragment:** only the canonical public URL. It is not sent to the static host, but it can appear in browser history/address bar until scrubbed. The Web app must scrub it immediately.
- **No server upload:** the design deliberately avoids a new metadata endpoint. This preserves the existing privacy model and avoids creating a new retention/logging surface.
- **Safari history:** even after `replaceState`, browser history/host logs are outside application control. Document this as a residual risk, as the existing privacy model already does for `/share`.

### 8.5 Worker and production boundaries

L2S did not change the Worker, Pages, Web/PWA, or Extension. The existing invariants remain:

- One explicit public URL per request.
- No user credentials or account cookies.
- No media proxy; media bytes go directly from the source/CDN to the device.
- Typed errors; no raw payloads in production logs.
- CORS allowlist remains the canonical Pages origin.
- The extension v0.3.0 remains unchanged.

The recommended diagnostics change is additive and closed-enum; it must not introduce raw upstream text, URLs, or content.

### 8.6 Legal and platform policy

- Instagram's terms may restrict automated access to its web endpoints. The Shortcut uses the same public endpoint as the existing Worker, from the user's device, without authentication. This does not remove the legal/product risk; it changes the network origin.
- Apple Shortcuts distribution does not involve App Store review, but Apple can change Shortcuts actions, signing, or import behavior. The Shortcut is not a stable platform API.
- A public Shortcut must not claim Instagram authorization, official support, or guaranteed access.
- Android APK sideloading avoids Play review but carries sideload trust warnings and signing/update obligations. Play distribution carries the policy risk identified in L1.
- Legal review is required before shipping either the Shortcut or an APK as a product feature.

---

## 9. Evidence and references

### 9.1 Repository evidence

| Path                                                       | Claim                                                                                                                                                       |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/resolver-client.ts`                          | Web client posts one URL to `/api/resolve`, uses `credentials: 'omit'`, 25 s abort, parses the strict schema, and maps unknown failures to `NETWORK_ERROR`. |
| `apps/web/src/error-messages.ts`                           | Known error codes use hard-coded UI messages; the Worker's stage-specific message is discarded for `LOGIN_REQUIRED`.                                        |
| `apps/web/src/stores/resolution.ts`                        | `IDLE → RESOLVING → RESOLVED/ERROR`; no stage field.                                                                                                        |
| `apps/web/src/views/HomeView.vue`                          | Error card renders title, message, and `error.code`; `/share` scrubs the query before resolving.                                                            |
| `apps/web/vite.config.ts`                                  | PWA manifest `share_target` action `/share`, GET, title/text/url; `autoUpdate` service worker.                                                              |
| `packages/meta-resolver/src/instagram/acquisition.ts`      | `classify` maps 3xx/401/403 to `LOGIN_REQUIRED`, 429 to `RATE_LIMITED`, 404/410 to `CONTENT_UNAVAILABLE`, non-JSON to `GRAPHQL_EXECUTION_ERROR`.            |
| `apps/resolver-worker/src/runtime.ts`                      | Bootstrap GET, `Set-Cookie` extraction, CSRF check, fixed GraphQL POST, cookie jar.                                                                         |
| `packages/meta-resolver/src/instagram/endpoint-profile.ts` | Fixed endpoint, app ID, `doc_id`, CSRF header/cookie names, variables.                                                                                      |
| `packages/meta-resolver/src/instagram/parser.ts`           | `parseInstagramMediaResponse` uses the supplied shortcode as authoritative and ignores the raw `code`.                                                      |
| `packages/meta-resolver/src/instagram/normalize.ts`        | `normalizeInstagramMedia` maps parsed media to the core `ResolveResult`.                                                                                    |
| `packages/core/src/resolver-api.ts`                        | Strict success/error schema; no `stage` field.                                                                                                              |
| `apps/resolver-worker/src/diagnostics.ts`                  | Internal closed-enum `DiagnosticStage`/`DiagnosticRecord`; not exposed to users.                                                                            |
| `apps/resolver-worker/src/dev-diagnostic.ts`               | Local-only diagnostic entry; production Worker does not import it.                                                                                          |
| `docs/ios-shortcut.md`                                     | Existing Shortcut forwards a URL to `/share`; it explicitly does not resolve posts, download media, or generate a `.shortcut` binary.                       |
| `docs/l1-local-first-resolver-feasibility.md`              | CORS/SOP/third-party-cookie constraints; PWA/extension/Tauri capability split.                                                                              |
| `docs/l2a-tauri-native-http-poc.md`                        | Desktop native HTTP success for one public image per platform; Android BUILD-ONLY; no-cookie CSRF-only single observation.                                  |

### 9.2 Official documentation

| Source                                                                                                                                     | Used for                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Apple Shortcuts User Guide, “Request your first API” — <https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios> | `GET`/`POST`/`PUT`/`PATCH`/`DELETE`; Request Body JSON/Form/File.                          |
| Apple Shortcuts User Guide, “API limitations” — <https://support.apple.com/guide/shortcuts/api-limitations-apd891a6c84e/ios>               | OAuth not supported; API rate limits; service terms.                                       |
| Apple Shortcuts action documentation (Matthew Cassinelli) — <https://matthewcassinelli.com/actions/get-contents-of-url/>                   | Headers, methods, body types, action identifier.                                           |
| Apple Shortcuts “Get Headers of URL” — <https://matthewcassinelli.com/actions/get-headers-of-url/>                                         | HEAD request returns header dictionaries; identifier `is.workflow.actions.url.getheaders`. |
| MDN, “Clipboard: readText()” — <https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/readText>                                       | Secure context; `NotAllowedError`; user-permission model.                                  |
| MDN, “Share Target” — <https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target>                  | Installed PWA requirement; Chromium support; GET/POST share data.                          |
| MDN, “CORS” — <https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS>                                                              | Cross-origin response exposure, `no-cors` opaque responses.                                |
| Chrome for Developers, Extensions docs — <https://developer.chrome.com/docs/extensions/get-started>                                        | Extension capabilities and distribution model; desktop extension context.                  |
| Apple Developer, App Transport Security — <https://developer.apple.com/documentation/security/preventing_insecure_network_connections>     | ATS/HTTPS expectations for native requests.                                                |
| Apple Shortcuts CLI — `/usr/bin/shortcuts` on macOS 15.7.9                                                                                 | `shortcuts sign --mode anyone --input … --output …` used for the experimental artifact.    |

### 9.3 Implementation and community evidence

| Source                                                                                                                                                                                    | Used for                                                                                                              | Classification                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Automators Talk, “Cookies are shared among multiple Get Contents of URL actions” — <https://talk.automators.fm/t/tip-cookies-are-shared-among-multiple-get-contents-of-url-actions/17197> | Cookie sharing within one shortcut run.                                                                               | **[P]** community evidence      |
| `ios-media-downloader-gateway` README — <https://github.com/aurimasniekis/ios-media-downloader-gateway>                                                                                   | A maintained Shortcut sends a `Cookie` header and per-item HTTP headers, and saves media to Photos/Files.             | **[P]** implementation evidence |
| Sindre Sorhus “Actions” app — <https://sindresorhus.com/actions>                                                                                                                          | “Get Contents of URL (Extended)” provides status codes, headers, all methods, and timeout; the stock action does not. | **[D]/[P]**                     |
| Shortcuts Playground plugin — <https://github.com/viticci/shortcuts-playground-plugin>                                                                                                    | Workflow plist structure, action IDs, validator, and signing guidance.                                                | **[S]/[P]** community tooling   |
| Reddit r/shortcuts discussions on `Set-Cookie`/`Get Headers of URL`                                                                                                                       | Reported ability to read response headers through the HEAD action.                                                    | **[P]** anecdotal               |
| Stack Overflow / community reports on iOS Safari URL length                                                                                                                               | Practical long-URL behavior; commonly cited around 80,000 characters.                                                 | **[P]** not a formal limit      |

### 9.4 Experimental evidence (this milestone)

| Evidence                             | Result                                                                          | Classification                                    |
| ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------- |
| Production Instagram probe           | `HTTP 403`, `LOGIN_REQUIRED`, GraphQL-stage message                             | **[E]**                                           |
| Production Threads control           | `HTTP 200`, `ok:true`, image                                                    | **[E]**                                           |
| Bootstrap GET                        | `200`, 501,534 bytes, `Set-Cookie: csrftoken`, HTML token equals cookie         | **[E]**                                           |
| GraphQL with token only              | `403` HTML                                                                      | **[E]**                                           |
| GraphQL with cookie + token          | `200` JSON, 22,419 bytes                                                        | **[E]**                                           |
| GraphQL multipart                    | `400` `invalid request`                                                         | **[E]**                                           |
| GraphQL JSON body (string variables) | `200` JSON                                                                      | **[E]**                                           |
| GraphQL JSON body (object variables) | `200` JSON                                                                      | **[E]**                                           |
| GraphQL production-like jar          | `200` JSON                                                                      | **[E]**                                           |
| GraphQL cookie without CSRF header   | `403` HTML                                                                      | **[E]**                                           |
| Embed page                           | `200` HTML, no CORS, `X-Frame-Options: DENY`                                    | **[E]**                                           |
| Signed Shortcut                      | `shortcuts sign` produced a 26,682-byte AEA archive; community validator passed | **[E]** local artifact only; not device-validated |
| iOS/iPadOS Shortcut execution        | **Not performed**                                                               | **NOT VERIFIED**                                  |
| Android runtime                      | **Not performed**                                                               | **NOT VERIFIED**                                  |

### 9.5 What was not tested

- No iPhone or iPad was available. The Shortcut was not imported, run, or share-sheet tested.
- No Android device/emulator was used for the L2A APK or for a new native path.
- No login, private content, Story, or account session was used.
- No carousel/video live Shortcut test. The macOS simulation used one public single-image post; the parser has fixture coverage for carousel/video, but live device behavior is unproven.
- No long-term reliability, rate-limit, or egress study. The request volume was intentionally small.
- No packet capture. The “no Worker contacted” claim for the Shortcut is a design invariant, not a packet-level observation.
- No legal/ToS review.
- No production deployment, Worker change, Pages change, Web/PWA change, or Extension change.

---

## 10. Recommended cross-platform architecture

### 10.1 Architecture

```text
                         ┌─────────────────────────────────────┐
                         │        Instagram share sheet        │
                         └───────────────┬─────────────────────┘
                                         │
             ┌───────────────────────────┴───────────────────────────┐
             │                                                       │
   Android / desktop Web                                  iPhone / iPad
             │                                                       │
   PWA Share Target / paste                               UniFetch Shortcut
             │                                                       │
   POST /api/resolve                                      bootstrap GET + fixed POST
             │                                                       │
   Cloudflare Worker  ◄──────── fallback /share?url= ────  raw public JSON
             │                                                       │
   typed result / error                                    clipboard + #url fragment
             │                                                       │
             └───────────────────────────┬───────────────────────────┘
                                         │
                              UniFetch Web UI /import
                                         │
                         existing TS parser + normalizer
                                         │
                              preview -> direct CDN download
```

### 10.2 Component responsibilities

| Component                       | Responsibility                                                                                        | Must not do                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Existing PWA + Worker           | Universal baseline; public metadata; Android share target; iOS URL-only fallback; typed errors        | Export credentials, proxy media, add authenticated acquisition                           |
| Shortcut                        | Device-local anonymous HTTP transport; bounded public JSON handoff; automatic Worker fallback         | Parse/normalize in Shortcuts; read account cookies; log/save metadata; retry for evasion |
| `/import` route                 | Clipboard read on user gesture; parser reuse; exact identity; CDN allowlist; size cap; scrub fragment | Upload metadata; render raw payload; trust clipboard blindly                             |
| Existing parser/normalizer      | Single source of truth for Instagram media                                                            | Gain a second parser in Shortcuts                                                        |
| Existing ResultPanel/downloader | Preview, selection, direct CDN downloads                                                              | Change the media path or add a proxy                                                     |
| Existing Worker                 | Fallback and Android baseline; typed errors                                                           | Change upstream behavior in L2S                                                          |
| Extension v0.3.0                | Desktop authenticated reference                                                                       | Change in L2S                                                                            |

### 10.3 Platform recommendations

| Platform              | Recommendation                                                                                                     | Why                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| iPhone/iPad           | Add the Shortcut as an **optional fast path** with automatic Worker fallback. Implement `/import` before shipping. | No new app; the user already has a Shortcut workflow; may avoid the Cloudflare-egress refusal.      |
| Android               | Keep PWA + Worker. Add stage-aware diagnostics and Retry/Open original. Do not require an APK.                     | No zero-install local transport. An APK is a friction regression and Android runtime is unverified. |
| Desktop Web           | Keep PWA + Worker.                                                                                                 | The failure is upstream, not desktop-specific.                                                      |
| Desktop Chromium      | Keep Extension v0.3.0.                                                                                             | It is the working authenticated local reference; do not change it.                                  |
| Threads               | Keep the Worker path.                                                                                              | The production control succeeded; Threads is not the failing platform.                              |
| Native iOS app        | Do not pursue.                                                                                                     | App Review policy risk; no advantage over the Shortcut for this use case.                           |
| Mandatory Android APK | Do not pursue.                                                                                                     | Violates the low-friction constraint; unverified runtime; policy/sideload burden.                   |

### 10.4 Why not a universal native app

A universal Tauri/native app would maximize local transport control but impose:

- APK install/sideload or App Store review;
- signing, updates, crash reporting, and security review;
- Android MediaStore/share-intent work that L2A has not done;
- iOS distribution policy risk;
- a second UI/parser surface.

It does not fit the user's stated low-friction priority. Keep the optional APK as a separate power-user experiment, not the default architecture.

### 10.5 Failure and fallback matrix

| Failure                                          | Shortcut behavior               | Web behavior                                                                               | User sees                            |
| ------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| Bootstrap `200`, token found, GraphQL `200` JSON | Copy JSON; open `/import#url=…` | Import button; parser; preview                                                             | Preview/download                     |
| Bootstrap `200`, token missing                   | Open `/share?url=…`             | Worker flow                                                                                | Existing typed error or success      |
| Bootstrap `3xx`/`401`/`403`/`429`                | Open `/share?url=…`             | Worker flow                                                                                | Existing typed error                 |
| GraphQL `3xx`/`401`/`403`/HTML                   | Open `/share?url=…`             | Worker flow                                                                                | Existing typed error                 |
| GraphQL JSON with application error              | Copy JSON; open `/import`       | Parser/classifier throws typed error                                                       | Typed error + standard-resolver link |
| Clipboard unreadable/empty                       | N/A                             | Import page shows “Copy the Shortcut result and tap Import again” + standard-resolver link | Clear instruction                    |
| Payload too large                                | N/A                             | Typed “too large” + standard-resolver link                                                 | Clear instruction                    |
| Wrong shortcode in clipboard                     | N/A                             | Reject; no preview                                                                         | Security error                       |
| Non-CDN asset URL                                | N/A                             | Reject asset or whole payload                                                              | Security error                       |
| Worker unreachable                               | Shortcut fallback also fails    | `NETWORK_ERROR`                                                                            | Stage-aware “Resolver unreachable”   |

---

## 11. Minimal iOS Shortcut experiment

### 11.1 Artifact status

| Item                                | Value                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Textual source                      | `research/l2s-mobile-local-resolver/shortcut/build_shortcut.py`                                              |
| Generated workflow                  | `research/l2s-mobile-local-resolver/shortcut/UniFetch-L2S-Experimental.xml`                                  |
| Build command                       | `python3 build_shortcut.py --sign`                                                                           |
| Signed artifact (local, gitignored) | `artifacts/UniFetch-L2S-Experimental.shortcut`                                                               |
| Size (one local build)              | 26,682 bytes                                                                                                 |
| SHA-256 (one local build)           | `a874dd9edfddd80afd671ac3dca8840b97d690ca97d9d051d565702176e561cb` (signing is not byte-reproducible)        |
| Validator                           | Community Shortcuts Playground validator: `Validation passed` with `--target-macos 27 --target-platform ios` |
| Signing                             | Apple `shortcuts sign --mode anyone`; AEA archive produced                                                   |
| iOS/iPadOS execution                | **NOT PERFORMED**                                                                                            |
| Import/share-sheet test             | **NOT PERFORMED**                                                                                            |

The signed binary is **not committed**. Signing is local and not reproducible; the hash is for one build only. The textual source and XML are committed.

### 11.2 Action graph

The generated workflow has 49 actions, including comments, conditions, and end markers. The functional path is:

| Step | Action                                | Key parameters                                                                                                                                                                                         |
| ---- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1    | Get URLs from Input                   | Shortcut Input (URL/text/Safari page)                                                                                                                                                                  |
| 2    | If URLs has any value                 | Condition 100                                                                                                                                                                                          |
| 3    | Get First Item from URLs              | First Item                                                                                                                                                                                             |
| 4    | Match Text                            | `^https://(?:www\.)?instagram\.com/(?:p                                                                                                                                                                | reel | reels)/[A-Za-z0-9_-]+/?(?:\?[^\s#]_)?(?:#[^\s]_)?$` |
| 5    | If Matches has any value              | Condition 100                                                                                                                                                                                          |
| 6    | URL                                   | `https://www.instagram.com/`                                                                                                                                                                           |
| 7    | Get Contents of URL                   | GET; Accept, Accept-Language, fixed UA, `Cache-Control: no-cache`, `Pragma: no-cache`                                                                                                                  |
| 8    | Get Text from Input                   | Bootstrap body                                                                                                                                                                                         |
| 9    | Match Text                            | `"csrf_token":"([A-Za-z0-9_-]+)"`                                                                                                                                                                      |
| 10   | If Matches has any value              | Condition 100                                                                                                                                                                                          |
| 11   | Get Group from Matched Text           | Group 1                                                                                                                                                                                                |
| 12   | Set Variable                          | `CSRF Token`                                                                                                                                                                                           |
| 13   | Match Text + Get Group + Set Variable | Extract `Shortcode` from the shared URL                                                                                                                                                                |
| 14   | URL Encode                            | Encode the original URL once                                                                                                                                                                           |
| 15   | Text                                  | `https://unifetch.pages.dev/share?url=<encoded>` (fallback)                                                                                                                                            |
| 16   | Text                                  | JSON body with `doc_id`, nested `variables`, `server_timestamps`                                                                                                                                       |
| 17   | Get Contents of URL                   | POST `https://www.instagram.com/graphql/query`; headers include `Content-Type: application/json`, `X-IG-App-ID`, `Referer`, fixed UA, `X-CSRFToken`, `Cookie: csrftoken=…`; body type File = JSON text |
| 18   | Get Text from Input                   | GraphQL body                                                                                                                                                                                           |
| 19   | If Text begins with `{`               | Condition 8                                                                                                                                                                                            |
| 20   | Set Clipboard                         | GraphQL body                                                                                                                                                                                           |
| 21   | Text                                  | `https://unifetch.pages.dev/import#url=<encoded>`                                                                                                                                                      |
| 22   | Open URL                              | Import URL                                                                                                                                                                                             |
| 23   | Otherwise                             | Open URL fallback `/share?url=…`                                                                                                                                                                       |
| 24   | End If                                | JSON check                                                                                                                                                                                             |
| 25   | Otherwise                             | Open URL fallback `/share?url=…`                                                                                                                                                                       |
| 26   | End If                                | Token check                                                                                                                                                                                            |
| 27   | Otherwise                             | Alert “supported link” message                                                                                                                                                                         |
| 28   | End If                                | URL validation                                                                                                                                                                                         |
| 29   | Otherwise                             | Alert “supported link” message                                                                                                                                                                         |
| 30   | End If                                | input check                                                                                                                                                                                            |

### 11.3 Manual build steps

If the signed artifact does not import or an action is red, build the same graph manually:

1. Create a shortcut named **UniFetch L2S Experimental**.
2. In **Details**, enable **Show in Share Sheet**; accept **URLs**, **Safari web pages**, and **Text**; set **If there's no input** to **Continue**.
3. Add **Get URLs from Input**.
4. Add **If** `URLs` `has any value`; inside, add **Get Item from List** → **First Item**.
5. Add **Match Text** on the first URL with the validation pattern above; add **If** `Matches` `has any value`.
6. Add **URL** `https://www.instagram.com/`; add **Get Contents of URL** with `GET` and the bootstrap headers; add **Get Text from Input**.
7. Add **Match Text** on the bootstrap text with the csrf pattern; add **If** `Matches` `has any value`.
8. Add **Get Group from Matched Text** (group 1); add **Set Variable** `CSRF Token`.
9. Extract the shortcode with **Match Text** `instagram\.com/(?:p|reel|reels)/([A-Za-z0-9_-]+)`, **Get Group**, **Set Variable** `Shortcode`.
10. Add **URL Encode** on the original URL; add **Text** `https://unifetch.pages.dev/share?url=` + encoded URL.
11. Add **Text** for the JSON body with the shortcode; add **Get Contents of URL** `POST` with the GraphQL headers and body type **File** = the JSON text. If the File body does not render, switch to **JSON** with `doc_id`, `variables` (nested dictionary), and `server_timestamps`; record which variant worked.
12. Add **Get Text from Input** on the GraphQL body; add **If** `Text` `begins with` `{`.
13. Inside the true branch: **Set Clipboard** = GraphQL body; **Text** `https://unifetch.pages.dev/import#url=` + encoded URL; **Open URL**.
14. Otherwise: **Open URL** the fallback `/share?url=` text.
15. End the JSON If. In the token If’s Otherwise, open the fallback. End the token If.
16. In the URL-validation If’s Otherwise, show an alert: `UniFetch couldn't find a supported Instagram link in the shared item.` End the If.
17. In the input If’s Otherwise, show the same alert. End the If.

### 11.4 Variants to test on device

The generated shortcut is one point in a small design space. The device tester should record which variant was used:

| Variant                                          | Change                                                         | Why it might be needed                                              |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------- |
| A. Explicit `Cookie` + `X-CSRFToken` (generated) | `Cookie: csrftoken=<token>` and `X-CSRFToken: <token>`         | Deterministic on macOS; may duplicate with Shortcuts' jar.          |
| B. Shared cookie jar                             | Remove the explicit `Cookie` header; keep `X-CSRFToken`        | If iOS rejects/merges a manual `Cookie` header.                     |
| C. JSON body via `WFJSONValues`                  | Use the JSON body type with nested `variables` instead of File | If the File body pattern does not render on the target OS.          |
| D. `Get Headers of URL` token                    | Use HEAD `Set-Cookie` instead of parsing the 500 KB HTML       | If the HTML regex is slow or the page is not text.                  |
| E. Fragment-only small payload                   | Base64 the raw JSON into `#d=` for small posts                 | Zero taps if the URL length is acceptable; not for large carousels. |

Do not mix variants without recording the result. Do not add retries or cookie/credential extraction to “make it work.”

### 11.5 Import instructions

1. Build: `cd research/l2s-mobile-local-resolver/shortcut && python3 build_shortcut.py --sign`.
2. Transfer `artifacts/UniFetch-L2S-Experimental.shortcut` to the device via AirDrop/Files.
3. Open in Shortcuts, review the actions, tap **Add Shortcut**.
4. Confirm **Show in Share Sheet** and the accepted input types.
5. Open a public Instagram image post, Share, choose **UniFetch L2S Experimental**.
6. Record whether the shortcut completes, whether Safari opens `/import` or `/share`, and whether the clipboard contains JSON.
7. Do not share screenshots containing captions, usernames, or media URLs. Record only pass/fail, stage, sizes, and typed errors.

If the artifact will not import, do not assume the workflow is valid. Use the manual build steps and compare the action graph. A signed plist that passes a validator is not proof of iOS importability.

### 11.6 What not to claim

- Do not claim the Shortcut “works on iOS” until a real device test passes.
- Do not claim it “bypasses CORS” as a feature; it is a native HTTP request, not a browser request.
- Do not claim it “fixes the 401” until device tests across networks show that.
- Do not claim it supports private/login-required content.
- Do not claim it replaces the Worker for Android.
- Do not claim the clipboard handoff is seamless; it requires one tap and may show a paste prompt.

---

## 12. Real-device validation checklist

### 12.1 Environment

- [ ] iPhone and iPad, current iOS/iPadOS, current Shortcuts app.
- [ ] Record device model, OS version, Shortcuts version, default browser.
- [ ] Wi-Fi and cellular.
- [ ] iCloud Private Relay **on** and **off**.
- [ ] VPN off; then one run with the user's normal VPN, if any.
- [ ] Low Power Mode off; then one run with it on.
- [ ] Content blocker off; then one run with it on, if installed.

### 12.2 Install and share entry

- [ ] Signed `.shortcut` imports; no “untrusted shortcut” block beyond the normal prompt.
- [ ] Action graph matches §11.2; no unexpected contacts/photos/files/shell actions.
- [ ] Shortcut appears in Instagram's share sheet.
- [ ] Empty input shows the supported-link alert, not an empty page.
- [ ] Non-Instagram URL shows the alert.
- [ ] `m.instagram.com`, `/stories/`, profile, and malformed shortcode fail closed.
- [ ] Duplicate shortcut names are removed before import.

### 12.3 Happy path

- [ ] Public single-image post: bootstrap `200`, token found, GraphQL JSON, clipboard populated, `/import` opens, Import tap reads the clipboard, preview matches the post, download succeeds.
- [ ] Public carousel (2, 4, 10, 20 items): same, with correct order and filenames.
- [ ] Public Reel/video: same, with video preview and download.
- [ ] The preview's author/caption match the shared post.
- [ ] The canonical URL in the import fragment is the post/Reel URL, not the share token.

### 12.4 Failure/fallback

- [ ] GraphQL `3xx`/`401`/`403`/HTML: shortcut opens `/share?url=…`; the Worker flow shows a typed error or succeeds.
- [ ] Token missing: shortcut opens `/share?url=…`.
- [ ] Worker unreachable: the fallback shows `NETWORK_ERROR`; no crash.
- [ ] Clipboard empty/unreadable: `/import` shows a clear instruction and a standard-resolver link.
- [ ] Payload too large: typed “too large” and standard-resolver link.
- [ ] Wrong shortcode/tampered JSON: rejected; no preview.
- [ ] Non-CDN asset URL: rejected.
- [ ] Private/login-required post: typed failure; no credential prompt.
- [ ] Repeated runs (5 consecutive shares): no stale-token or duplicate-cookie failure.
- [ ] Run after 30+ minutes: token/bootstrap still works or fails cleanly.

### 12.5 Privacy and security

- [ ] No `sessionid`, `ds_user_id`, `Authorization`, or account cookie appears in any header, clipboard, screenshot, or log.
- [ ] Clipboard contains only public JSON; it is cleared/overwritten after import.
- [ ] The fragment is scrubbed from the address bar/history after import.
- [ ] The import page never renders raw HTML/JSON.
- [ ] The import page rejects non-HTTPS/non-CDN asset URLs.
- [ ] No network request goes to a UniFetch metadata endpoint beyond the existing Worker fallback.
- [ ] No media bytes pass through UniFetch.
- [ ] The Shortcut's alerts do not contain tokens, URLs, captions, or media URLs.

### 12.6 Performance and UX

- [ ] Measure bootstrap + GraphQL time on Wi-Fi and cellular (target: a few seconds; record actual).
- [ ] Measure `/import` load/import time for the largest carousel.
- [ ] Record whether Safari or the installed PWA opens.
- [ ] Record the clipboard permission prompt text and how many times it appears.
- [ ] Record whether the share sheet buries the shortcut and whether the user must scroll.
- [ ] Record iPad multitasking behavior.
- [ ] Record any shortcut timeout/background suspension.

### 12.7 Stop conditions

Stop and report, do not work around:

- any credential/login prompt;
- repeated `401`/`403`/challenge pages;
- duplicate-cookie failure that requires cookie extraction;
- a shortcut that only works by using the user's account session;
- an import path that requires uploading metadata to a server;
- a clipboard permission prompt on every run that makes the flow worse than the current one;
- a crash or data loss;
- a payload that cannot be validated for exact identity.

### 12.8 Evidence to record

Record only:

- pass/fail per test;
- stage (`BOOTSTRAP`, `SESSION`, `GRAPHQL`, `IMPORT`, `PREVIEW`, `DOWNLOAD`);
- typed error code;
- HTTP status class (if the third-party extended action is used);
- payload byte size (not content);
- elapsed time;
- whether Private Relay/VPN was on;
- device/OS/Shortcuts/browser versions.

Do not record URLs, captions, usernames, tokens, cookies, headers, raw bodies, or signed media URLs.

---

## 13. GO / CONDITIONAL GO / NO-GO criteria

### 13.1 Track A — iOS Shortcut experiment

**CONDITIONAL GO** to the real-device experiment, because:

- the exact HTTP sequence works from a non-Cloudflare network;
- the required action primitives are documented;
- the handoff can reuse the existing parser;
- the Worker fallback preserves the existing flow;
- no credentials or new app are required.

**GO to product** only if all of the following hold:

1. The signed Shortcut imports and appears in the Instagram share sheet on both iPhone and iPad.
2. At least 5 public samples per content type (image, carousel, Reel) resolve on Wi-Fi and cellular.
3. The clipboard handoff works with one tap or less of additional friction than the current flow, and the paste prompt is acceptable.
4. The Shortcut's native path succeeds on a network where the production Worker currently returns `LOGIN_REQUIRED`, or the fallback is seamless when it does not.
5. The `/import` route passes the security review: exact shortcode check, CDN allowlist, size cap, no raw rendering, no server upload.
6. The Worker fallback works for all native-path failures.
7. No credential prompt, cookie export, challenge bypass, or retry-for-evasion is introduced.
8. Legal/ToS review accepts the device-side public request.
9. The Shortcut source is version-controlled, reviewable, and reproducible enough to rebuild.
10. The maintenance owner accepts the Shortcut/iOS behavior risk.

**NO-GO** if:

- iOS rejects the `Cookie` header or cannot supply a usable CSRF context;
- Instagram consistently returns a login/challenge page to the device;
- the clipboard permission or URL-length constraints make the flow worse than the current Worker flow;
- the only working variant requires account cookies or a third-party app;
- the import path cannot validate exact identity or CDN hosts;
- real-device reliability is not better than the Worker baseline.

### 13.2 Track B — Android zero-install local transport

**NO-GO.** No supported zero-install browser capability can read Instagram metadata cross-origin. Do not ship a WASM/Service Worker/iframe “solution” that repackages Fetch. Do not make an APK mandatory.

**CONDITIONAL GO** to a separate diagnostics/fallback milestone:

- add a closed-enum `stage` and `retryable` to the error contract;
- show a stage-aware message, not the generic “This post requires sign-in”;
- add Retry and Open original;
- keep the Worker as the baseline;
- do not change upstream behavior.

### 13.3 Optional Android native shell (candidate D)

**NO-GO for the default journey.** A separate, optional L2B/L2C experiment can continue only after:

- Android runtime validation (not just BUILD-ONLY);
- share intent and MediaStore/gallery export;
- release signing/update channel;
- policy/legal review;
- a clear statement that it is optional and not required for ordinary users.

### 13.4 Overall verdict

**CONDITIONAL GO.**

- Go: device-gated iOS Shortcut + `/import` experiment; diagnostics/fallback UX.
- No-go: zero-install Android local transport; mandatory APK; productionizing the Shortcut before device evidence.
- Do not start L2B, W1, Facebook, or a native iOS app in this milestone.

---

## 14. Recommended next implementation milestone

### 14.1 Primary: L2T — iOS Shortcut Native Transport + Web Import (device-gated)

**Goal:** Prove or disprove the only zero-new-app path that can improve Apple-device Instagram reliability.

**Scope:**

1. Implement `/import` in a research branch, not production:
   - fragment `#url=` parsing and scrubbing;
   - clipboard read on user gesture;
   - size cap;
   - raw shortcode check;
   - `parseInstagramMediaResponse` + `normalizeInstagramMedia` reuse;
   - CDN allowlist;
   - typed errors and a “Use standard resolver” link;
   - no server upload, no raw rendering.
2. Keep the generated Shortcut source; add the manual build instructions and variant matrix.
3. Run the real-device checklist in §12 on iPhone and iPad.
4. Measure success rate against the Worker baseline on the same posts/networks.
5. Record only privacy-safe evidence.
6. Do not deploy to Pages or change the production Worker in L2T.

**Acceptance criteria:**

- At least one public image, carousel, and Reel resolve through the Shortcut on both iPhone and iPad.
- The Worker fallback works when the native path fails.
- No credential/cookie export.
- Exact identity and CDN validation pass negative tests.
- The user-facing flow is not worse than the current flow by more than one tap/prompt.

**Non-goals:** Android APK, L2B external WebView/session bridge, W1, Facebook, production deployment, authenticated content, Story, private content.

**Rough effort:** 2–4 days for `/import` + validation; 1–2 days for the Shortcut variants; 1–2 days for device testing; 1–2 days for documentation/security review. These are estimates, not commitments.

### 14.2 Companion: L2D — Resolver Diagnostics & Fallback UX

**Goal:** Stop misleading users and make the next incident diagnosable on every platform.

**Scope:**

- Add a versioned `stage`/`retryable`/closed status-class block to the Worker error response.
- Update the strict Zod schema and the Web client in one change.
- Show a “Diagnostic details” expansion and a “Copy diagnostic” action with no URL/content.
- Add Retry and Open original.
- Add tests for every stage and for no raw payload leakage.
- Do not change upstream request behavior or add retries.

**Why now:** It is low risk, helps Android and iOS, and would have made this incident's stage unambiguous. It does not fix the upstream refusal, but it prevents the next false “this post requires sign-in” conclusion.

### 14.3 Future option: L2E — Worker egress redundancy (Android)

**Goal:** Improve Android reliability without an APK.

**Idea:** Run the same fixed public profile from a second, independently hosted egress (another Cloudflare account/region, a small VPS, or a different provider) and compare success rates. Keep the same privacy model: no credentials, no media proxy, one URL per request, typed errors, no retries for evasion.

**Status:** Feasibility only. It requires deployment and cost/security review; it is not part of L2S/L2T. Do not deploy automatically.

### 14.4 Explicit do-not-start list

- Do not start L2B external-WebView/session-bridge work.
- Do not deploy Worker or Pages.
- Do not change the production Web/PWA.
- Do not modify Extension v0.3.0.
- Do not add a mandatory Android APK.
- Do not add Facebook support.
- Do not begin W1 filename synchronization.
- Do not rebuild unrelated packages.
- Do not modify production authentication handling.
- Do not overstate the reliability of unverified transport approaches.

---

## Appendix A — Reproduce the evidence

### A.1 macOS HTTP simulation (public-only, sanitized)

The exact commands used a temporary directory and printed only status, byte counts, token presence, and structural markers. They did not print the token, cookies, or signed media URLs. A minimal reproduction:

```sh
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
curl -sS --max-time 20 -A "$UA" \
  -H 'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' \
  -H 'Accept-Language: en-US,en;q=0.8' \
  -D boot.headers -o boot.html 'https://www.instagram.com/'
# Inspect only status/Set-Cookie presence and token presence. Do not print the token.
TOKEN=$(grep -o '"csrf_token":"[A-Za-z0-9_-]*"' boot.html | head -1 | sed 's/.*:"//;s/"$//')
curl -sS --max-time 20 -A "$UA" \
  -H 'Accept: */*' -H 'Accept-Language: en-US,en;q=0.8' \
  -H 'Content-Type: application/json' \
  -H 'X-IG-App-ID: 936619743392459' \
  -H 'Referer: https://www.instagram.com/' \
  -H "X-CSRFToken: $TOKEN" -H "Cookie: csrftoken=$TOKEN" \
  --data '{"doc_id":"27128499623469141","variables":{"shortcode":"DPCM9i1iTOx","__relay_internal__pv__PolarisAIGMMediaWebLabelEnabledrelayprovider":false},"server_timestamps":"true"}' \
  -o response.json -w '%{http_code}\n' 'https://www.instagram.com/graphql/query'
# Record only status, byte count, and whether the media root is present.
```

Do not commit `boot.html`, `response.json`, the token, cookies, or signed media URLs. The sample is public; use a user-owned or public test post and keep the request count small.

### A.2 Production probe (read-only)

```sh
curl -sS --max-time 30 -X POST \
  'https://unifetch-resolver.cernmeow.workers.dev/api/resolve' \
  -H 'Origin: https://unifetch.pages.dev' \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://www.instagram.com/p/DPCM9i1iTOx/"}'
```

This is a read-only probe of the existing deployment. It does not deploy or change anything. The public URL is visible to the Worker, as in a normal user resolve.

### A.3 Build and validate the Shortcut

```sh
cd research/l2s-mobile-local-resolver/shortcut
python3 build_shortcut.py
plutil -lint UniFetch-L2S-Experimental.xml
# Optional community validator (not vendored):
# python3 /path/to/shortcuts-playground/.../validate_shortcut.py \
#   UniFetch-L2S-Experimental.xml --target-macos 27 --target-platform ios
python3 build_shortcut.py --sign
shasum -a 256 ../../../artifacts/UniFetch-L2S-Experimental.shortcut
```

The community validator and signing are local checks, not device validation.

### A.4 Why there is no `shortcut-cli` in this repository

The repository did **not** contain a `shortcut-cli` workflow, script, dependency, or generated `.shortcut` before L2S. `docs/ios-shortcut.md` explicitly says the project does not generate a `.shortcut` binary and uses an iCloud link. The existing Shortcut source is a manual action list, not a version-controlled generator.

L2S added a minimal Python generator and used the community Shortcuts Playground validator plus Apple's `shortcuts sign`. This is new tooling, not an existing workflow. If the project adopts this direction, the generator and validator should be part of the L2T branch and ideally tested on a macOS CI runner with a real Shortcuts import step.

---

## Appendix B — Source-to-claim map

| Claim                                                               | Source                                                                                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| The production Instagram failure is GraphQL-stage `LOGIN_REQUIRED`. | Production Worker response message; `packages/meta-resolver/src/instagram/acquisition.ts`; `apps/resolver-worker/src/runtime.ts`. |
| The Worker and CORS were healthy during the probe.                  | Threads production control returned `200` with a normalized image.                                                                |
| The current UI hides the stage.                                     | `apps/web/src/error-messages.ts` hard-codes `LOGIN_REQUIRED`; `HomeView.vue` renders the code.                                    |
| Shortcuts supports GET/POST and JSON/Form/File bodies.              | Apple Shortcuts User Guide, “Request your first API”.                                                                             |
| Shortcuts can set headers.                                          | Apple guide + action documentation.                                                                                               |
| Stock Shortcuts does not expose status/headers.                     | Action returns the body; third-party Actions app advertises the missing status/headers/timeout.                                   |
| Cookies are shared within one run.                                  | Automators Talk community tip; not official.                                                                                      |
| A maintained Shortcut sends a `Cookie` header.                      | `ios-media-downloader-gateway` README.                                                                                            |
| Android browser cannot read Instagram metadata cross-origin.        | MDN CORS/SOP; L1 report.                                                                                                          |
| Share Target only delivers a URL.                                   | MDN `share_target`; `apps/web/vite.config.ts`.                                                                                    |
| The embed page is not a CORS fallback.                              | Our `curl` showed no `Access-Control-Allow-Origin` and `X-Frame-Options: DENY`.                                                   |
| The parser treats the supplied shortcode as authoritative.          | `packages/meta-resolver/src/instagram/parser.ts` comment and code.                                                                |
| The import path needs a raw-code check and CDN allowlist.           | Security analysis in §8.3; parser behavior.                                                                                       |
| Android APK runtime is unverified.                                  | `docs/l2a-tauri-native-http-poc.md` §5 and §10.                                                                                   |
| Extension v0.3.0 is unchanged.                                      | No extension files changed in L2S; git status.                                                                                    |

---

## Appendix C — Scope and change log for L2S

### Added

- `docs/l2s-mobile-local-resolver-feasibility.md` (this report)
- `research/l2s-mobile-local-resolver/shortcut/build_shortcut.py`
- `research/l2s-mobile-local-resolver/shortcut/UniFetch-L2S-Experimental.xml`
- `research/l2s-mobile-local-resolver/shortcut/README.md`
- L1 and L2A reports brought onto the L2S branch as docs-only context (no PoC code)

### Updated

- `docs/HANDOFF.md` — Traditional Chinese L2S section and next-milestone guidance

### Explicitly unchanged

- `apps/web` production behavior
- `apps/resolver-worker` behavior and deployment
- `apps/extension` v0.3.0
- `packages/meta-resolver` parser/normalizer behavior
- `packages/core` API schema
- Production Pages/Worker
- `opencode.jsonc` (untracked, preserved)
- `artifacts/` (gitignored; the signed Shortcut is local only)
- The L2A PoC directory (untracked working-tree content; not committed to L2S)

### Validation performed

- `plutil -lint` on the generated Shortcut XML: OK
- Community Shortcuts Playground validator: passed
- Apple `shortcuts sign`: produced a 26,682-byte signed archive
- Production Worker read-only probes: Instagram `LOGIN_REQUIRED`; Threads `200`
- macOS public HTTP simulation: 12 requests as listed in §4.3
- No iOS/iPadOS/Android runtime test
- No production deployment

---

**End of L2S report.** The next action is not “build more native software.” It is to test the smallest Apple-device fast path on real hardware, with a Worker fallback, and to make the Resolve stage visible on every platform. Android’s honest answer is still the hosted Worker, not a mandatory APK.
