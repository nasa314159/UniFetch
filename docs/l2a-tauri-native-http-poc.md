# L2A — Tauri Native HTTP Local Resolver PoC

**Status:** CONDITIONAL GO to a narrowly scoped L2B
**Date:** 2026-10-25
**Branch:** `research/l2a-tauri-native-http-poc`
**Base:** `main` at `44086be` plus the docs-only L1 commit `f9764ee`
**Scope:** One public single-image Instagram post and one public single-image
Threads post, resolved through device-local native HTTP, parsed by the existing
UniFetch TypeScript packages, and saved to an application-controlled file.
**Out of scope:** authentication, login orchestration, external Instagram
WebView injection, remote-origin Tauri IPC, cookie export, Android share
intents, MediaStore/gallery export, iOS, background downloads, production
Worker/Pages/Extension changes, W1 filename alignment, Facebook, carousel/
video/GIF breadth.

## Evidence legend

| Tag                            | Meaning                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| **VERIFIED ON DESKTOP**        | Executed on this macOS host by the native Rust core, with real network I/O. |
| **VERIFIED IN AUTOMATED TEST** | Executed by a focused test, including the Tauri mock-IPC layer.             |
| **BUILD-ONLY**                 | Compiled/packaged successfully; not executed on the target OS.              |
| **NOT VERIFIED**               | Not executed in this environment.                                           |
| **FAILED**                     | Attempted and did not meet the requirement.                                 |

Android runtime is **NOT VERIFIED**. Android APK compilation is **BUILD-ONLY**.
The desktop Tauri GUI was not launched; desktop transport/save evidence comes
from the same native core through a headless self-test, and the Tauri command
surface is covered by mock-IPC tests.

---

## 1. Executive summary

L2A asked one question: can a device-local native HTTP request acquire public
Instagram/Threads metadata, reuse the existing UniFetch parsers, and save real
media without the Cloudflare Resolver Worker? On this macOS host, for one
public single-image sample per platform, the answer is **yes**.

What was actually observed:

- Instagram: a fixed anonymous bootstrap returned HTTP 200 with a `csrftoken`;
  one fixed-profile GraphQL request with only `X-CSRFToken` (no `Cookie`
  header) returned HTTP 200 JSON (22,419 bytes). The existing parser accepted
  it as one image (1125×1406, author `lastlineofdefense`). The image was
  downloaded (607,762 bytes, JPEG) and saved with a verified signature and
  SHA-256.
- Threads: one canonical SSR request returned HTTP 200 HTML (834,105 bytes).
  The existing parser accepted it as one image (1220×1412, author `threads`).
  The image was downloaded (168,144 bytes, JPEG) and saved with a verified
  signature and SHA-256.
- Neither path contacted the Cloudflare Worker. Neither path sent a `Cookie`
  or `Authorization` header.
- The Tauri command surface is exactly five commands. The local-only capability
  has no remote URL grant and no plugin permissions. Tauri mock-IPC tests
  confirmed that a remote document cannot invoke the local command surface and
  that an unregistered `fs` plugin command is denied.
- The Android project generated and built both a debug APK (172 MiB,
  unstripped, cleartext enabled for debug) and an unsigned release APK (16 MiB,
  `usesCleartextTraffic=false`, only `INTERNET` permission). No Android device
  or emulator was available, so Android runtime behavior is **NOT VERIFIED**.

What is not proven:

- Android runtime behavior, Android network egress behavior, and Android file
  save behavior.
- Long-term Instagram reliability. One successful request is not proof that the
  Cloudflare-origin 401 will stay away, and the `doc_id`/app-ID profile is
  unstable upstream implementation detail.
- Whether the no-`Cookie` CSRF-only request is consistently sufficient; the
  production Worker currently sends an anonymous cookie jar, and this PoC does
  not.
- Threads live username-alias redirect behavior. The transport and tests
  implement it, but the live sample did not redirect.
- Authenticated content, carousel/video/GIF, share links, login, MediaStore,
  share intents, background downloads, or iOS.
- Legal/ToS/store-policy acceptance.

**L2A verdict: CONDITIONAL GO.** Device-local native HTTP is a credible
replacement for Cloudflare-origin _public_ metadata acquisition on desktop. It
is not yet a credible Android product claim, and it is not a replacement for
the extension's authenticated desktop path.

---

## 2. Exact implementation architecture

### 2.1 Component diagram

```text
┌──────────────────────────────────────────────────────────────┐
│ Local UI (Vue 3, bundled app origin only)                    │
│  - parseSupportedUrl + parse*ContentRef (existing TS)        │
│  - invoke('resolve_instagram', {shortcode, kind})            │
│  - invoke('resolve_threads', {username, shortcode})          │
│  - parse*MediaResponse / parseThreadsSsrHtml (existing TS)   │
│  - normalize*Media (existing TS)                             │
│  - invoke('save_media', {url, suggestedFilename})            │
└───────────────────────────┬──────────────────────────────────┘
                            │ local capability only
┌───────────────────────────▼──────────────────────────────────┐
│ Rust core (trusted)                                           │
│  - validates shortcode/username/kind; never accepts a URL     │
│  - constructs every upstream URL from a fixed origin          │
│  - reqwest + rustls, no cookie store, manual redirects        │
│  - Instagram: fixed bootstrap GET + fixed GraphQL POST        │
│  - Threads: canonical SSR GET + at most one alias redirect    │
│  - media: HTTPS CDN allowlist, max 3 redirects, 25 MiB cap    │
│  - signature check, sanitized filename, temp+rename, SHA-256  │
└───────────────────────────┬──────────────────────────────────┘
                            │ direct HTTPS
┌───────────────────────────▼──────────────────────────────────┐
│ Instagram / Threads public origins + media CDN                │
│  - no UniFetch Worker, no proxy, no media relay               │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Trust boundaries

| Boundary               | Trusted? | Rule                                                                   |
| ---------------------- | -------- | ---------------------------------------------------------------------- |
| Local Vue UI           | Yes      | Bundled app origin only; no remote navigation; no asset protocol.      |
| Rust command surface   | Yes      | Five typed commands; no generic fetch/fs/shell/opener/dialog.          |
| Upstream JSON/HTML     | No       | Bounded, content-type checked, parsed by existing fail-closed parsers. |
| Media bytes            | No       | HTTPS + CDN allowlist, size cap, signature check, no HTML/JSON save.   |
| Filesystem destination | Yes      | App data directory only; filename sanitized by Rust.                   |
| Tauri remote origins   | No       | No `remote.urls` capability; remote IPC denied by ACL.                 |
| Cloudflare Worker      | Not used | No Worker origin in configuration or request code.                     |

### 2.3 Why the split is Rust transport + TypeScript parsing

The PoC deliberately does **not** reimplement the Instagram or Threads parser
in Rust. Rust owns only the privileged boundary:

- exact-origin request construction;
- redirect policy;
- timeouts and response-size caps;
- header policy (no cookies, no authorization);
- bounded body transfer;
- media download, filename, signature, and file write.

The existing TypeScript packages own the semantic work:

- `parseInstagramContentRef` / `parseThreadsContentRef` validate the user URL
  and produce the exact canonical reference before any native call.
- `parseInstagramMediaResponse` / `normalizeInstagramMedia` parse and normalize
  the Instagram response.
- `parseThreadsSsrHtml` / `normalizeThreadsMedia` parse and normalize the
  Threads SSR response, including exact publisher validation.
- `createCaptionFilename` (via the existing Threads normalizer) preserves the
  caption-first filename policy.

The only intentional duplication is the small Instagram endpoint profile
(endpoint, app ID, doc ID, CSRF cookie/header names, fixed headers, and
variables) in Rust. It is pinned there because the transport must not accept a
caller-supplied endpoint or header profile. Rust unit test
`instagram::tests::pins_the_production_profile_constants` guards the key
values.

### 2.4 Request flows

**Instagram public single image**

```text
User URL
  → TS parseSupportedUrl + parseInstagramContentRef
  → invoke resolve_instagram(shortcode, kind)
  → Rust GET https://www.instagram.com/ (fixed headers)
  → read only the anonymous csrftoken from Set-Cookie; no cookie store
  → Rust POST https://www.instagram.com/graphql/query
       fixed body + X-IG-App-ID + X-CSRFToken
       no Cookie, no Authorization
  → bounded JSON (1 MiB)
  → TS parseInstagramMediaResponse + normalizeInstagramMedia
  → one image asset
  → invoke save_media(url, suggestedFilename)
  → Rust HTTPS CDN GET (max 3 allowlisted redirects, 25 MiB)
  → JPEG/PNG/WebP/GIF signature check
  → app_data_dir/downloads/<sanitized>.jpg
```

**Threads public single image**

```text
User URL
  → TS parseSupportedUrl + parseThreadsContentRef
  → invoke resolve_threads(username, shortcode)
  → Rust GET https://www.threads.com/@<username>/post/<shortcode>/
       fixed browser-like navigation headers, no cookies
  → 200 HTML (4 MiB cap) or at most one same-origin same-shortcode redirect
  → TS parseThreadsSsrHtml(finalRef) + normalizeThreadsMedia
       parser checks exact shortcode and publisher against the served URL
  → one image asset
  → invoke save_media(url, suggestedFilename)
  → same native save path as Instagram
```

**What is not in the flow:** no Worker request, no external WebView, no login,
no cookie extraction, no share intent, no gallery/MediaStore, no background
task, no retry loop.

### 2.5 Tauri command surface

| Command               | Inputs                              | Network? | Notes                                                       |
| --------------------- | ----------------------------------- | -------- | ----------------------------------------------------------- |
| `resolve_instagram`   | `shortcode`, `kind` (`post`/`reel`) | Yes      | Fixed bootstrap + fixed GraphQL profile.                    |
| `resolve_threads`     | `username`, `shortcode`             | Yes      | Fixed canonical post URL; max one alias redirect.           |
| `save_media`          | `url`, `suggestedFilename`          | Yes      | URL revalidated; path chosen by Rust; signature checked.    |
| `security_self_check` | none                                | No       | 40 local negative checks.                                   |
| `app_info`            | none                                | No       | Versions, fixed origins, limits, no-cookie/no-Worker flags. |

No command accepts a request method, header map, arbitrary origin, filesystem
path, or shell command.

---

## 3. Files added or changed

### 3.1 Added PoC

`research/l2a-tauri-native-http-poc/`

| Path                                   | Purpose                                                    |
| -------------------------------------- | ---------------------------------------------------------- |
| `package.json`, `pnpm-workspace.yaml`  | Standalone PoC package and lockfile scope.                 |
| `vite.config.ts`, `vitest.config.ts`   | Vue/Vite build and tests; aliases to existing TS packages. |
| `src/App.vue`, `src/styles.css`        | Minimal trusted local UI.                                  |
| `src/lib/contracts.ts`                 | TypeScript types mirroring the Rust command payloads.      |
| `src/lib/resolver.ts`                  | Existing parser/normalizer adapter + typed `invoke` calls. |
| `src/lib/resolver.test.ts`             | Frontend adapter/negative tests (10 tests).                |
| `tests/live-parser.test.ts`            | Opt-in live evidence parser test; skips without evidence.  |
| `scripts/live-evidence.mjs`            | Bounded live run orchestrator; writes sanitized summary.   |
| `src-tauri/src/instagram.rs`           | Fixed Instagram bootstrap + GraphQL transport.             |
| `src-tauri/src/threads.rs`             | Fixed Threads SSR transport + one alias redirect.          |
| `src-tauri/src/media.rs`               | CDN allowlist, redirects, size cap, signature, file save.  |
| `src-tauri/src/validate.rs`            | Reference, origin, redirect, and size validation.          |
| `src-tauri/src/security.rs`            | 40 local security checks.                                  |
| `src-tauri/src/diagnostics.rs`         | Static, sanitized stage diagnostics.                       |
| `src-tauri/src/error.rs`               | Static `PocError`; cannot carry raw URLs/tokens.           |
| `src-tauri/src/commands.rs`            | Five Tauri commands; no generic privileged command.        |
| `src-tauri/src/selftest.rs`            | Headless fetch/save/security evidence CLI.                 |
| `src-tauri/tests/ipc.rs`               | Tauri mock-IPC allowlist/negative tests (7 tests).         |
| `src-tauri/capabilities/default.json`  | Local-window-only capability; no remote URLs.              |
| `src-tauri/permissions/autogenerated/` | Autogenerated `allow-*` permissions for the five commands. |
| `src-tauri/tauri.conf.json`            | Tauri v2 config, strict CSP, local window only.            |
| `src-tauri/icons/`                     | Generated desktop/Android/iOS icon assets.                 |
| `README.md`                            | Reproduce build/test/live/Android steps.                   |

### 3.2 Repository documentation and tooling

| Path                                | Change                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------- |
| `docs/l2a-tauri-native-http-poc.md` | This report.                                                           |
| `docs/HANDOFF.md`                   | Traditional Chinese L2A handoff section.                               |
| `eslint.config.js`                  | Ignore `research/**` so root lint does not scan generated Rust target. |
| `.prettierignore`                   | Ignore generated PoC target/gen/evidence/lockfile artifacts.           |

### 3.3 Explicitly unchanged

- `apps/web` (Web/PWA) — no source or config change.
- `apps/resolver-worker` — no source, wrangler, or deployment change.
- `apps/extension` — no v0.3.0 source, manifest, or release change.
- `packages/*` — no production parser/normalizer/downloader change.
- Published GitHub releases, Pages deployment, production environment
  variables, and unrelated branches.
- `opencode.jsonc` remains untracked and untouched.

The production `pnpm build`, `typecheck`, `test`, `lint`, and `format:check`
gates were re-run after the change; all passed (940 production tests).

---

## 4. Dependency and Tauri versions

| Component                  | Version                                                |
| -------------------------- | ------------------------------------------------------ |
| Tauri crate                | 2.12.5                                                 |
| `tauri-build`              | 2.7.4                                                  |
| `tauri-runtime-wry`        | 2.12.3                                                 |
| WRY                        | 0.57.1                                                 |
| `@tauri-apps/cli`          | 2.12.4                                                 |
| `@tauri-apps/api`          | 2.12.4                                                 |
| Rust                       | 1.99.1 (stable, 2026-10-13)                            |
| Cargo                      | 1.99.1                                                 |
| `reqwest`                  | 0.12.28 (`rustls-tls`)                                 |
| `tokio`                    | 1.54.1                                                 |
| `rustls`                   | 0.23.46                                                |
| `url`                      | 2.5.8                                                  |
| `sha2`                     | 0.10.9                                                 |
| Vue                        | 3.5.44                                                 |
| Vite                       | 7.3.7                                                  |
| Vitest                     | 3.2.4                                                  |
| TypeScript                 | 5.9.3                                                  |
| Node.js                    | 26.7.0                                                 |
| pnpm (PoC standalone)      | 12.4.2                                                 |
| pnpm (repository root)     | 10.28.2 (unchanged)                                    |
| Android NDK                | 27.0.12077973                                          |
| Android compile/target SDK | 37                                                     |
| Android build-tools        | 36.0.0                                                 |
| Gradle wrapper             | 9.6.1                                                  |
| JDK used for Android build | 25.0.2 (Android Studio JBR)                            |
| Rust Android target        | `aarch64-linux-android` (plus other targets installed) |

The PoC uses its own `pnpm-workspace.yaml` and lockfile (lockfile v9), so the
root workspace and its lockfile are untouched.

---

## 5. Android toolchain and runtime status

### 5.1 Toolchain found/installed

| Item                         | Status                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Android SDK                  | Present at `~/Library/Android/sdk`; platforms 35/36/37.                                           |
| Build-tools                  | 34.0.0 and 36.0.0.                                                                                |
| Command-line tools           | Installed user-local (`cmdline-tools/latest`).                                                    |
| NDK                          | Installed user-local: `27.0.12077973`.                                                            |
| Java                         | 25.0.2 (system and Android Studio JBR).                                                           |
| Rust Android targets         | `aarch64-linux-android`, `armv7-linux-androideabi`, `i686-linux-android`, `x86_64-linux-android`. |
| Connected device             | None (`adb devices` empty).                                                                       |
| AVD                          | None.                                                                                             |
| Android runtime verification | **NOT VERIFIED**.                                                                                 |

No Android system image or emulator was created. The milestone did not require
GUI automation, and installing a large emulator image was not necessary to
establish build compatibility.

### 5.2 Build results

`pnpm tauri android init` generated `src-tauri/gen/android` successfully
(gitignored).

| Artifact                             | Size    | SHA-256                                                            | Notes                                                 |
| ------------------------------------ | ------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| `app-universal-debug.apk`            | 172 MiB | `8e7c62ba9dde9465380acbe792da33f74a6cced7b7dab51907d6dabcc2582d77` | Debug, unstripped, `debuggable=true`, cleartext true. |
| `app-universal-release-unsigned.apk` | 16 MiB  | `7e5fe47f7c219b04c736aee0dc0b3d740edf0e61128ca23c79fa78ba47a92738` | Release, stripped, unsigned, cleartext false.         |

Both APKs contain `lib/arm64-v8a/libunifetch_l2a_lib.so`. Manifest facts:

- package `dev.unifetch.l2a`, version `0.1.0`;
- `minSdkVersion=24`, `targetSdkVersion=37`;
- only `android.permission.INTERNET` plus the Tauri/AndroidX dynamic-receiver
  permission;
- release `android:usesCleartextTraffic="false"`;
- debug `android:usesCleartextTraffic="true"` (Tauri debug/dev behavior);
- no storage, camera, location, contacts, or media permissions.

### 5.3 Build warnings

- Gradle/AGP 9 emitted deprecation warnings about legacy variant APIs and
  source/target Java 8.
- JDK 25 is newer than the Java version the Tauri Android template targets;
  compilation succeeded, but a JDK 17/21 toolchain is safer for reproducible
  Android releases.
- The release APK is unsigned. Signing, versioning, and update delivery are
  L2B+ work.

### 5.4 Manual Android device test procedure

1. Connect an Android 7.0+ device with USB debugging, or boot an arm64
   emulator.
2. Install the debug APK:
   `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
3. Launch **UniFetch L2A PoC**.
4. Paste `https://www.instagram.com/p/DPCM9i1iTOx/`, tap **Resolve locally**,
   then **Save image**.
5. Paste `https://www.threads.com/@threads/post/DNgrJ8UyTAF/`, repeat.
6. Record the diagnostics stages and statuses. Expected origins are only
   `https://www.instagram.com` and `https://www.threads.com`.
7. Verify the saved-file evidence in the UI (filename, bytes, type, SHA-256,
   path). For a debug build, also run:
   `adb shell run-as dev.unifetch.l2a find files -type f`
8. If Instagram returns 401/403/challenge on Android, record the exact stage
   and stop. Do not add retries, proxies, fingerprint spoofing, CAPTCHA
   solving, or cookie extraction.
9. Repeat on Wi-Fi and mobile data to compare egress behavior.
10. Do not claim Android success from the APK build alone.

---

## 6. Desktop runtime verification

### 6.1 Environment

- macOS 15.7.9 (24G830), Apple M3 Pro, arm64.
- Rust stable 1.99.1, Node 26.7.0, pnpm 12.4.2.
- No visible Chrome, browser, or Tauri GUI window was launched. The desktop
  validation used the headless native self-test plus Tauri mock-IPC tests.

### 6.2 Build and test results

| Gate                                                               | Result                                                |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| `pnpm build` (Vue + Vite)                                          | Pass                                                  |
| `pnpm test` (frontend adapters)                                    | 10 passed; live parser tests skipped without evidence |
| `cargo test` (Rust unit)                                           | 18 passed                                             |
| `cargo test --test ipc` (Tauri mock runtime)                       | 7 passed                                              |
| `cargo clippy --all-targets -- -D warnings`                        | Pass                                                  |
| `cargo fmt -- --check`                                             | Pass                                                  |
| `pnpm tauri build --no-bundle` (release)                           | Pass; 14 MiB binary                                   |
| `--self-test security`                                             | 40 passed, 0 failed                                   |
| Root `pnpm lint` / `typecheck` / `test` / `build` / `format:check` | Pass; 940 production tests                            |

Desktop release binary:
`src-tauri/target/release/unifetch-l2a`, SHA-256
`932ad24c9385c32b64c6680b6d316f78498b6b35faffa7d73af92da2da5f383a`.

### 6.3 What the desktop evidence proves

- The real Rust transport executed against the real Instagram and Threads
  origins from this host.
- The real existing TypeScript parsers accepted the real responses.
- The real Rust save path wrote real image bytes to disk and verified them.
- The Tauri command handlers and ACL can be invoked under Tauri's mock runtime;
  the local command surface works, and remote/unregistered commands are denied.

### 6.4 What it does not prove

- A real Tauri WebView rendering the Vue UI, real IPC from that WebView, or
  desktop packaging/notarization. `tauri build --no-bundle` compiled the
  release binary; no `.app`/DMG was produced or launched.
- Any Android behavior.
- Long-term upstream stability.

---

## 7. Instagram and Threads request results

### 7.1 Instagram

Sample: `https://www.instagram.com/p/DPCM9i1iTOx/` (public single-image post).
Live run timestamp: `2026-10-25T05:29:39Z`.

| Stage                                | Result                  | Evidence                                                      |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------- |
| Native bootstrap request executed    | Yes                     | `GET https://www.instagram.com/`                              |
| Bootstrap upstream response received | Yes                     | HTTP 200                                                      |
| Anonymous CSRF context extracted     | Yes                     | `csrftoken` present; no cookie store                          |
| `Cookie` header sent                 | **No**                  | Diagnostics `INSTAGRAM_COOKIE_HEADER: not_sent`               |
| Fixed GraphQL request executed       | Yes                     | `POST https://www.instagram.com/graphql/query`                |
| GraphQL upstream response received   | Yes                     | HTTP 200, `application/json; charset=utf-8`                   |
| Response body bounded                | Yes                     | 22,419 bytes (cap 1 MiB)                                      |
| Existing parser accepted response    | Yes                     | `parseInstagramMediaResponse`                                 |
| Kind                                 | Image                   | `media.kind === 'image'`                                      |
| Publisher                            | `lastlineofdefense`     | Parsed owner                                                  |
| Dimensions                           | 1125×1406               | Parsed candidate                                              |
| Exact-post identity                  | Shortcode `DPCM9i1iTOx` | Parser uses expected shortcode; Instagram URL has no username |
| Media bytes downloaded               | Yes                     | HTTP 200; 607,762 bytes                                       |
| File saved and verified              | Yes                     | JPEG signature, exists, nonempty, SHA-256                     |
| Cloudflare Worker contacted          | **No**                  | No Worker origin in code/config; trace origin only Instagram  |
| Relevant security checks passed      | Yes                     | 40/40                                                         |

Exploratory context (not part of the final PoC flow): a single manual probe
without a CSRF header returned HTTP 403 HTML from Instagram. The PoC therefore
keeps the fixed bootstrap/CSRF step. The PoC sends **only** the ephemeral
`X-CSRFToken` header; it does not send the anonymous cookie jar that the
production Worker currently uses. That succeeded once on this network. This is
a hypothesis for L2B, not a reliability claim.

A 200 HTML login/challenge page would fail the JSON content-type and
body-shape checks before parsing; a 3xx redirect is rejected; a 200 JSON
application error is classified by the existing parser. No fallback media is
used.

Interpretation: the Cloudflare-origin 401 observation was **not reproduced**
from this residential/macOS egress for this sample. That does not prove the 401
is fixed or that Instagram will consistently serve this profile. It only shows
that the native path worked for one bounded request.

### 7.2 Threads

Sample: `https://www.threads.com/@threads/post/DNgrJ8UyTAF/` (public
single-image post). Live run timestamp: `2026-10-25T05:29:39Z`.

| Stage                                 | Result                                       | Evidence                                                      |
| ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| Native post request executed          | Yes                                          | `GET https://www.threads.com/@threads/post/DNgrJ8UyTAF/`      |
| Upstream response received            | Yes                                          | HTTP 200                                                      |
| Content type                          | HTML                                         | `text/html; charset="utf-8"`                                  |
| Response body bounded                 | Yes                                          | 834,105 bytes (cap 4 MiB)                                     |
| Canonical redirect observed           | No                                           | `redirected=false`                                            |
| Existing SSR parser accepted response | Yes                                          | `parseThreadsSsrHtml`                                         |
| Kind                                  | Image                                        | `media.kind === 'image'`                                      |
| Publisher                             | `threads`                                    | Parser checks owner against final URL                         |
| Dimensions                            | 1220×1412                                    | Parsed candidate                                              |
| Exact-post identity                   | Shortcode `DNgrJ8UyTAF` + username `threads` | Parser checks both                                            |
| Current-username alias behavior       | Not observed live                            | Same-shortcode alias accept/reject covered by automated tests |
| Media bytes downloaded                | Yes                                          | HTTP 200; 168,144 bytes                                       |
| File saved and verified               | Yes                                          | JPEG signature, exists, nonempty, SHA-256                     |
| `Cookie`/`Authorization` sent         | **No**                                       | Diagnostics `THREADS_COOKIE_HEADER: not_sent`                 |
| Cloudflare Worker contacted           | **No**                                       | Trace origin only Threads                                     |
| Relevant security checks passed       | Yes                                          | 40/40                                                         |

A 200 login/challenge page without the exact post payload is rejected by the
existing parser; it cannot silently select an unrelated post or fall back to
media from another page.

Interpretation: Threads public SSR acquisition works through native HTTP with
fixed browser-like navigation headers and no credentials. The live sample did
not exercise a stale-username redirect. The transport accepts exactly one
same-origin redirect only when the stable shortcode is unchanged; unit and
frontend tests cover cross-origin, HTTP, wrong-shortcode, login, and no-op
rejections.

### 7.3 Request-volume statement

The live run performed:

- 1 Instagram bootstrap GET;
- 1 Instagram GraphQL POST;
- 1 Threads post GET;
- 1 media GET per platform;
- no retries, no parallel bursts, no enumeration.

A small number of manual pre-implementation probes (no-CSRF, bootstrap, and
token-only) were made while selecting the design. No high-volume requests were
sent.

---

## 8. Downloaded-file evidence

All files were produced by the native Rust save path and verified with
`file` and `shasum -a 256`. The downloaded media and raw upstream responses are
gitignored; the sanitized `evidence/summary.json` and
`evidence/security.json` are committed.

| Platform  | File                                        | Bytes   | SHA-256                                                            |
| --------- | ------------------------------------------- | ------- | ------------------------------------------------------------------ |
| Instagram | `instagram_DPCM9i1iTOx.jpg`                 | 607,762 | `ab64fabfab94512cb020046ec81e8266a9cfa47a5a8de6d03566084cb6dba829` |
| Threads   | `threads_On-web_-add-a-photo-to-a-post.jpg` | 168,144 | `e722063facc46762dc981f14f59bfb508af997483e8018c4b9141952f0de387a` |

`file` output:

```text
instagram_DPCM9i1iTOx.jpg: JPEG image data, JFIF standard 1.01, aspect ratio,
density 1x1, segment length 16, progressive, precision 8, 1125x1406,
components 3
threads_On-web_-add-a-photo-to-a-post.jpg: JPEG image data, JFIF standard 1.01,
aspect ratio, density 1x1, segment length 16, progressive, precision 8,
1220x1412, components 3
```

Verification performed by Rust:

- `Content-Type` was `image/jpeg`; HTML/JSON was rejected by policy.
- JPEG SOI signature (`FF D8 FF`) was detected.
- File exists and is nonempty; on-disk length equals the downloaded length.
- SHA-256 was computed over the exact bytes written.
- Filename was sanitized; extension came from the detected signature (`.jpg`
  for JPEG), not from the untrusted URL.
- Destination was the app-controlled root (`evidence/downloads` for the
  self-test; `app_data_dir/downloads` in the Tauri command). The frontend
  cannot supply a path.
- No MediaStore, gallery, or share-sheet export was implemented.

The filenames are understandable and stable; the Threads filename is
caption-first and sanitized, so punctuation becomes `_` and long captions are
truncated.

---

## 9. Security boundary and negative tests

### 9.1 Boundary summary

| Control              | Implementation                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Command surface      | Exactly 5 commands; no generic fetch/fs/shell/opener/dialog/process.                                            |
| Capability           | `windows: ["main"]`, local only, `core:default` + 5 `allow-*` app permissions, no `remote.urls`.                |
| Remote-origin IPC    | Denied by absence of remote capability; Tauri mock test confirms.                                               |
| Input shape          | Shortcode/username/kind only; no URL/method/header/path inputs for metadata.                                    |
| Origin construction  | Fixed `https://www.instagram.com` and `https://www.threads.com`; media CDN allowlist.                           |
| Scheme               | HTTPS only for metadata and media.                                                                              |
| SSRF/private network | IP literals, localhost, private/metadata hosts, unlisted hosts, userinfo, custom ports, and fragments rejected. |
| Instagram redirects  | None accepted (manual redirect policy; 3xx classified).                                                         |
| Threads redirects    | At most one same-origin, same-shortcode username alias; login/cross-origin/wrong-post/no-op rejected.           |
| Media redirects      | At most 3; every hop must remain on the HTTPS CDN allowlist.                                                    |
| Size caps            | 1 MiB Instagram JSON; 4 MiB Threads HTML; 25 MiB media; `Content-Length` + streaming checks.                    |
| Timeouts             | 20 s metadata; 30 s media.                                                                                      |
| Credentials          | No cookie store; no `Cookie`/`Authorization` header; Instagram uses only ephemeral `X-CSRFToken`.               |
| Diagnostics          | Static stage/outcome/status/bytes/elapsed/detail; no URLs, query strings, headers, cookies, tokens, or bodies.  |
| Errors               | `PocError` fields are `&'static str`; no dynamic upstream values.                                               |
| File save            | App data directory; Rust-generated filename; sanitization; temp+rename; signature; exists/nonempty; SHA-256.    |
| CSP                  | `default-src 'self'`; no remote img/script/connect; no asset protocol.                                          |
| Android release      | `usesCleartextTraffic=false`; only `INTERNET` permission.                                                       |

### 9.2 Local security self-check (40/40)

`cargo run -- --self-test security evidence/security.json` (also exposed as the
`security_self_check` command) passed **40/40** checks. Groups:

- **Scheme/URL:** `http`, `file`, `javascript`, `data`.
- **SSRF/private:** `127.0.0.1`, `localhost`, `169.254.169.254`, `10.0.0.1`,
  `192.168.1.1`, unlisted host, lookalike host, userinfo, custom port, fragment.
- **Non-Worker origins:** generic `*.workers.dev` and `*.pages.dev` URLs are
  rejected by the media allowlist.
- **Allowed CDN:** valid `*.cdninstagram.com` and `*.fbcdn.net` URLs accepted.
- **References:** shortcode traversal, whitespace, overlong, URL, slash, query;
  username traversal/URL; valid shortcode/username accepted.
- **Threads redirects:** cross-origin, HTTP, wrong shortcode, login, no-op
  rejected; same-shortcode alias accepted.
- **Fixed URL construction:** Instagram and Threads canonical URLs are
  constructed, not caller-supplied.
- **Size caps:** oversized `Content-Length` rejected; bounded accepted.
- **Redaction:** serialized diagnostics and errors contain no `http`, query
  marker, `instagram.com`, or `csrftoken`.
- **HTML/unknown signatures:** rejected by the media signature check.
- **Filename traversal:** path components, control characters, and overlong
  names sanitized.

### 9.3 Tauri mock-IPC tests (7/7)

| Test                                                                                             | Result                         |
| ------------------------------------------------------------------------------------------------ | ------------------------------ |
| Local window can invoke `security_self_check`                                                    | Pass                           |
| `app_info` reports no Worker/no cookie header and fixed origins                                  | Pass                           |
| Malformed Instagram shortcode rejected before network (`INVALID_URL`, stage `INSTAGRAM_REF`)     | Pass                           |
| Malformed Threads username rejected before network (`INVALID_URL`, stage `THREADS_REF`)          | Pass                           |
| Non-HTTPS media URL rejected before filesystem/network (`INVALID_URL`, stage `MEDIA_URL_SCHEME`) | Pass                           |
| Remote document (`https://evil.example`) cannot invoke the local command surface                 | Pass                           |
| Unregistered `plugin:fs                                                                          | read_text_file` command denied | Pass |

These tests use Tauri's mock runtime, not a real WebView. They prove the
command/ACL layer, not GUI rendering.

### 9.4 Negative tests not run against live upstream

To avoid abusive traffic, the PoC did **not** make real upstreams return
oversized bodies, redirects to attacker origins, or malformed content. Those
paths are covered by pure unit tests (`content_length_allowed`, `exceeds`,
signature detection, redirect validators, media URL validator). This is a
deliberate limitation.

### 9.5 Residual risks

- DNS rebinding between validation and request is not fully prevented; the
  host allowlist + TLS certificate validation are the primary controls.
- No certificate pinning; a compromised CA or TLS stack is out of scope.
- The CDN allowlist is a wildcard (`*.cdninstagram.com`, `*.fbcdn.net`); it is
  intentionally the same trust boundary as the existing parser, but it is
  broad.
- No OS-level network sandbox or independent security audit.
- The local UI is trusted; a compromised UI bundle could invoke the five
  commands. The command implementations still validate all references and
  media URLs.
- Android debug builds enable cleartext for the dev server; release builds
  disable it. The native transport itself is HTTPS-only in both.

---

## 10. Remaining limitations

1. **Android runtime is NOT VERIFIED.** No device or AVD was available. APK
   compilation is BUILD-ONLY. Do not claim Android resolution/save works.
2. **Desktop Tauri GUI/IPC with a real WebView is NOT VERIFIED.** The release
   binary compiled; the native core and Tauri mock-IPC layer were tested; no
   visible GUI was launched per safety constraints.
3. **One public sample per platform.** This is not a reliability, rate-limit,
   or long-term access study.
4. **Instagram profile instability.** `doc_id`/app ID/headers are upstream web
   implementation details and can change without notice.
5. **No-Cookie CSRF-only behavior is a single observation.** The production
   Worker sends an anonymous cookie jar; the PoC does not. Consistency across
   networks/accounts is unproven.
6. **Threads live alias redirect not observed.** The code/tests implement and
   reject the relevant cases, but the live sample was already canonical.
7. **Single-image only.** Carousels, video, GIF, stories, profiles, and share
   links fail closed or are unsupported.
8. **No authentication.** Login, session reuse, cookie extraction, and
   authenticated content are out of scope.
9. **No Android share intent, MediaStore, gallery, background download, or
   foreground service.**
10. **No iOS build.** iOS remains PWA + Shortcut per L1.
11. **No release signing/update channel.** The Android release APK is unsigned.
12. **JDK 25 is newer than the Android template's Java target.** The build
    succeeded with warnings; a JDK 17/21 toolchain is recommended for L2B.
13. **No legal/ToS/store-policy review.** APK sideload vs Play distribution
    remains a product/legal decision.
14. **No independent security review** of the command surface, capability, or
    media allowlist.
15. **No real-device performance/size measurements** beyond APK size and desktop
    binary size.
16. **No upstream abuse testing.** Oversized/redirect/HTML responses were not
    elicited from real upstreams.
17. **No user-facing cancellation.** Requests are bounded by timeouts (20 s
    metadata, 30 s media) but cannot be cancelled from the UI.
18. **The successful `save_media` path through real Tauri IPC was not
    exercised.** The native save function was executed by the headless
    self-test; the Tauri command's validation/ACL was exercised by mock IPC.
    The `AppHandle::app_data_dir()` resolution on a real desktop/Android app
    remains a manual verification item.
19. **No packet capture.** The "no Worker contacted" claim is a code/config
    invariant plus the observed trace origins, not a packet-level capture.

---

## 11. L2A verdict

### **CONDITIONAL GO**

The L2A objective is met on desktop for the narrow public single-image path:

- native HTTP metadata acquisition succeeded for Instagram and Threads;
- existing TypeScript parsers/normalizers accepted the responses;
- exact-post identity checks were preserved;
- actual media bytes were downloaded and saved locally;
- the Worker was not contacted;
- the security boundary passed 40 local checks and 7 Tauri mock-IPC tests;
- Android builds, but Android runtime is unverified.

This is **not** a GO to productize or to replace the existing extension/PWA.
It is a GO to continue a narrowly scoped L2B that first closes the Android
runtime gap and validates the public path across a small set of samples.

The L1 stop conditions were not triggered:

- No WebView login was attempted.
- No same-origin GraphQL injection was attempted.
- No remote capability or cookie export was introduced.
- Android save did not require broad permissions (it is app-private only).
- The only distribution assumption tested is build-only APK; policy review is
  still required.

---

## 12. L2B entry criteria and recommendation

### 12.1 Required before L2B implementation expands

1. **Android runtime validation** on a real device or emulator:
   - install the debug APK;
   - resolve the Instagram and Threads samples;
   - save both images;
   - verify file existence, size, signature, and SHA-256;
   - capture the exact diagnostics and network origins;
   - repeat on Wi-Fi and mobile data.
2. **Instagram egress check on Android.** If 401/403/challenge appears, record
   the exact stage and stop. Do not add retries, proxy rotation, fingerprint
   spoofing, CAPTCHA solving, or cookie extraction.
3. **Low-volume multi-sample validation** (for example, 5 public image posts
   per platform, explicitly bounded) to check parser/profile stability and
   rate-limit behavior. Do not crawl or enumerate.
4. **Decide the Instagram session-context policy** for native HTTP: keep the
   CSRF-only no-cookie approach, or deliberately add an ephemeral anonymous
   cookie jar. Base this on evidence, not convenience.
5. **Add an on-device debug self-test or instrumentation path** so the native
   core can be exercised without GUI automation. A debug-only intent/CLI entry
   is preferable to mouse-click automation.
6. **Independent review** of the five-command surface, capability, media
   allowlist, redirect policy, and redaction.
7. **Legal/ToS/store-policy review** for the intended distribution (APK
   sideload vs Play).
8. **Release engineering**: signing, versioning, update channel, crash
   reporting with redaction, and reproducible Android builds on JDK 17/21.

### 12.2 Recommended L2B shape

Keep L2B public-only and narrow:

- Android-first runtime validation of the existing PoC;
- no login, no external WebView, no remote IPC, no share intent, no MediaStore;
- one image per action, fail closed on carousel/video/GIF;
- same parser/normalizer reuse;
- same app-private save path until a separate MediaStore milestone is approved.

Do **not** start authenticated Instagram or the exact-post WebView bridge in
L2B. That is a separate milestone (L2C or later) and requires its own threat
model, capability design, and policy review.

### 12.3 Explicit non-goals for L2B

- iOS App Store distribution.
- Play Store submission without policy review.
- Facebook.
- Background downloads.
- Multi-account/session management.
- Cookie export or WebView session sharing.
- Production Worker/Pages/Extension changes.
- W1 filename alignment.

---

## Appendix A — Reproduce the evidence

```sh
cd research/l2a-tauri-native-http-poc
pnpm install
pnpm test
pnpm build
pnpm rust:test
pnpm rust:clippy
pnpm rust:fmt
pnpm security
pnpm tauri build --no-bundle
L2A_ALLOW_LIVE=1 pnpm live:evidence
```

The live run writes `evidence/summary.json` (committed, sanitized) and the
actual images under `evidence/downloads/` (gitignored).

## Appendix B — Evidence file map

| File                            | Contains                                                    | Sensitive?                              |
| ------------------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `evidence/summary.json`         | Sanitized stages, statuses, sizes, hashes, security counts  | Committed; no signed URLs               |
| `evidence/security.json`        | 40 local checks                                             | Committed; no secrets                   |
| `evidence/instagram-fetch.json` | Instagram status/content-type/bootstrap/CSRF/diagnostics    | Gitignored; no cookies/tokens           |
| `evidence/threads-fetch.json`   | Threads status/content-type/final canonical ref/diagnostics | Gitignored; no cookies/tokens           |
| `evidence/instagram-raw.json`   | Bounded raw Instagram JSON                                  | Gitignored; contains signed CDN URLs    |
| `evidence/threads-raw.html`     | Bounded raw Threads HTML                                    | Gitignored; may contain signed CDN URLs |
| `evidence/instagram-asset.json` | Parser-selected media URL + filename                        | Gitignored; contains a signed CDN URL   |
| `evidence/threads-asset.json`   | Parser-selected media URL + filename                        | Gitignored; contains a signed CDN URL   |
| `evidence/downloads/*.jpg`      | Actual saved images                                         | Gitignored; user content                |

## Appendix C — Source-to-claim map

| Claim                                  | Evidence                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Instagram bootstrap 200 + CSRF present | `evidence/summary.json` `posts.instagram`; `INSTAGRAM_CSRF_EXTRACTION`                                               |
| No Cookie header sent                  | `INSTAGRAM_COOKIE_HEADER` / `THREADS_COOKIE_HEADER` diagnostics; code has no cookie header construction              |
| Instagram GraphQL 200 JSON             | `posts.instagram.status=200`, `contentType`, 22,419 bytes                                                            |
| Threads SSR 200 HTML                   | `posts.threads.status=200`, 834,105 bytes                                                                            |
| Existing parser accepted both          | `evidence/instagram-parsed.json`, `threads-parsed.json`; live parser test                                            |
| Exact-post identity                    | Instagram expected shortcode; Threads parser owner/shortcode check                                                   |
| Actual media saved                     | `evidence/downloads/*.jpg`; `file`; SHA-256; `*-save.json`                                                           |
| No Worker                              | No Worker origin in config/code; trace origins only Instagram/Threads; generic Worker URL rejected by security check |
| Android build                          | debug/release APK paths, sizes, SHA-256, manifest dump                                                               |
| Android runtime not verified           | `adb devices` empty; no AVD; report labels BUILD-ONLY                                                                |
| Tauri remote IPC denied                | `src-tauri/tests/ipc.rs::remote_origin_cannot_invoke_the_local_command_surface`                                      |
| Unregistered plugin denied             | `src-tauri/tests/ipc.rs::local_ipc_denies_unregistered_plugin_commands`                                              |
| 40 security checks                     | `evidence/security.json`                                                                                             |
