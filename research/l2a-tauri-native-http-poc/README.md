# UniFetch L2A — Native HTTP Local Resolver PoC

This is an isolated research PoC for the L2A milestone. It is **not** part of
the production pnpm workspace and must not be merged into `main`.

It demonstrates one narrow path:

```text
public single-image Instagram / Threads URL
  → existing TypeScript URL/reference validation
  → typed Tauri command with only a shortcode/username
  → native Rust HTTPS request from the device
  → existing TypeScript parser + normalizer
  → native image download
  → app-controlled local file save with signature/hash verification
```

No Cloudflare Resolver Worker is contacted. No Cookie or Authorization header
is sent. No login, share intent, MediaStore/gallery export, background
download, iOS build, or production code change is included.

The full findings are in
[`docs/l2a-tauri-native-http-poc.md`](../../docs/l2a-tauri-native-http-poc.md).

## Prerequisites

- Rust stable (tested with 1.99.1) and Cargo
- Node.js (tested with 26.7.0) and pnpm (tested with 12.4.2)
- macOS/Linux/Windows desktop Tauri dependencies for a desktop build
- Android only: Android SDK, NDK 27.0.12077973, JDK 17–25, and the Rust Android
  targets

This PoC has its own `pnpm-workspace.yaml` and lockfile, so installing it does
not modify the root workspace.

## Install and test

```sh
cd research/l2a-tauri-native-http-poc
pnpm install
pnpm test                 # frontend adapter tests (live parser tests skip without evidence)
pnpm build                # vue-tsc + Vite production build
pnpm rust:test            # Rust unit + Tauri mock-IPC tests
pnpm rust:clippy          # Clippy with -D warnings
pnpm rust:fmt             # rustfmt check
pnpm security             # 40 local security-boundary checks
```

## Desktop build

```sh
pnpm tauri build --no-bundle
# binary: src-tauri/target/release/unifetch-l2a
```

Do not launch a visible GUI in automated validation. The desktop evidence was
produced with the headless native self-test plus Tauri mock-IPC tests; real
WebView interaction remains a manual step.

For an interactive local check:

```sh
pnpm tauri dev
```

## Bounded live evidence

The live run is opt-in and deliberately low volume. It performs one Instagram
bootstrap, one Instagram GraphQL request, one Threads post request, and one
media download per platform.

```sh
L2A_ALLOW_LIVE=1 pnpm live:evidence
```

Default public samples:

- Instagram: `https://www.instagram.com/p/DPCM9i1iTOx/`
- Threads: `https://www.threads.com/@threads/post/DNgrJ8UyTAF/`

Override with `L2A_IG_SHORTCODE`, `L2A_IG_KIND`, `L2A_THREADS_USERNAME`, and
`L2A_THREADS_SHORTCODE`.

Outputs under `evidence/` (raw responses and media are gitignored; the
sanitized `summary.json` and `security.json` are committed):

- `summary.json` — sanitized stages, statuses, sizes, hashes, security counts
- `instagram-raw.json`, `threads-raw.html` — bounded upstream responses
- `instagram-fetch.json`, `threads-fetch.json` — sanitized metadata/diagnostics
- `instagram-asset.json`, `threads-asset.json` — parser output for the save step
- `downloads/*.jpg` — actual saved media
- `instagram-save.json`, `threads-save.json` — file evidence
- `security.json` — local negative-test report

Raw responses and signed media URLs are intentionally kept out of git and out
of diagnostics.

## Android build

```sh
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"

# Once per clean checkout (generates src-tauri/gen/android, gitignored)
pnpm tauri android init

# Debug APK (installed by the manual device test)
pnpm tauri android build --apk --debug --target aarch64

# Release APK (unsigned in this PoC)
pnpm tauri android build --apk --target aarch64 --ci
```

Artifacts:

- `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`

Android runtime was **not verified** in this environment: no device and no AVD
were available. See the report for the exact manual device procedure.

## Manual Android device test

1. Connect a device with USB debugging, or boot an emulator.
2. `adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
3. Launch **UniFetch L2A PoC**.
4. Paste the Instagram sample, tap **Resolve locally**, then **Save image**.
5. Paste the Threads sample, repeat.
6. Confirm the UI shows a saved filename, byte count, JPEG/PNG type, and
   SHA-256, and that the diagnostics list only
   `https://www.instagram.com` / `https://www.threads.com`.
7. For a debug build, inspect the app-private file:

   ```sh
   adb shell run-as dev.unifetch.l2a find files -type f
   ```

8. Record the exact stage if Instagram returns 401/403. Do not add retries,
   proxy rotation, fingerprint spoofing, or challenge bypass.

## Security notes

- The only Tauri commands are `resolve_instagram`, `resolve_threads`,
  `save_media`, `security_self_check`, and `app_info`.
- No `tauri-plugin-http`, `fs`, `shell`, `opener`, `dialog`, or `process`
  plugin is installed.
- The capability is local-window-only, has no `remote.urls`, and grants only
  the five app permissions plus `core:default`.
- The commands accept references, not URLs. Rust constructs every upstream URL.
- Media downloads are HTTPS-only, restricted to `*.cdninstagram.com` /
  `*.fbcdn.net`, bounded to 25 MiB, signature-checked, and saved under the
  application data directory with a sanitized filename.
- Diagnostics never contain URLs, query strings, headers, cookies, tokens, or
  response bodies.

## Out of scope

Instagram login/auth orchestration, external Instagram WebView injection,
remote-origin IPC, cookie export, Android share intents, MediaStore/gallery
export, iOS builds, background downloads, production Worker/Pages/Extension
changes, W1 filename alignment, Facebook, carousel/video/GIF breadth.
