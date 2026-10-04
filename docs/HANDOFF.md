# UniFetch Handoff

## Repository

Repository: https://github.com/nasa314159/UniFetch.git
Branch: `main`

## Production

Web/PWA: https://unifetch.pages.dev
Resolver: https://unifetch-resolver.cernmeow.workers.dev

## Product

UniFetch is a local-first media acquisition interface currently focused on Instagram. Public Image Post, Carousel, and Reel metadata resolution is supported within the tested anonymous-access scope. Deterministic demos remain available.

## Mobile entry paths

Android: Instagram → Share → UniFetch PWA Share Target → automatic resolution.

iOS/iPadOS: Instagram → Share → UniFetch Apple Shortcut → UniFetch `/share` → automatic resolution.

Validated Shortcut distribution link: https://www.icloud.com/shortcuts/9ff25727f16a43cfa6eac1e3ccd49a82

## Current trust boundary

Metadata path: Instagram → UniFetch Resolver Worker → browser.
Media path: Instagram CDN → browser/device directly.

The current application has:

- No Instagram username/password collection or `sessionid` input.
- No cookie import/upload or persistent Instagram session.
- No media proxy or persistent server-side media storage.
- Media bytes delivered directly to the device; downloads are explicitly user initiated.
- No intentionally stored resolution history or offline media archive.

Do not weaken these boundaries without explicit architecture approval.

## Current validated behavior

- **Images:** client-side JPEG normalization, human-readable filenames, and Android gallery visibility confirmed.
- **Multi-asset downloads:** Android direct multi-download works. iOS/iPadOS uses a prepared-file Save queue when required. Physical validation saved 4/4 requested assets and preserved original indices (`_01.jpg` … `_04.jpg`).
- **Install:** Android PWA install and Share Target confirmed; iOS Add to Home Screen confirmed. Install is hidden in the installed app.
- **iOS sharing:** Add UniFetch Shortcut uses the validated iCloud link; manual setup remains the fallback. Real iPhone sharing and automatic resolution are confirmed.
- **Access errors:** generic GraphQL application failures without a reliable auth/age marker become `GRAPHQL_EXECUTION_ERROR`. Explicit authentication markers or HTTP 401/403 become `LOGIN_REQUIRED`. No distinct `AGE_RESTRICTED` category is enabled; it requires a reliable age-specific structural marker. `PARSER_OUTDATED` represents media parsing/schema failures, not generic GraphQL access failures.

M7E physical validation confirmed the restricted post shows `GRAPHQL_EXECUTION_ERROR`, a working public post still resolves, and no credentials, cookies, or session data are requested. The frontend API schema accepts this code without substituting `PARSER_OUTDATED`.

## Known limitation

Some Instagram posts require authenticated access, including age-restricted content. The current Web/PWA Resolver intentionally does not receive user Instagram credentials. Do not add password input, `sessionid` input, or cookie upload/import to work around this limitation.

If authenticated acquisition is pursued later, prefer a browser extension or native runtime where the authenticated context stays on the user's device. Neither runtime is implemented.

## Current platform scope

Instagram: supported within the public anonymous-access scope.
Facebook: not implemented.
Threads: not implemented.

## Important docs

Read only as needed:

- `README.md`
- `docs/architecture.md`
- `docs/privacy-model.md`
- `docs/ios-shortcut.md`
- `docs/batch-downloads.md`

## Agent instructions

1. Read `docs/HANDOFF.md` first.
2. Read `README.md` second.
3. Do not broadly scan the repository.
4. Read only packages/files directly relevant to the task.
5. Do not reconstruct the full project history.
6. Do not research architecture unless explicitly asked.
7. Preserve validated Android/iOS behavior unless the task explicitly changes it.
8. Preserve the trust boundary.
9. Keep milestone work narrow.
10. Hold commit/push when physical-device validation is explicitly required.

Relevant areas: `apps/web`, `apps/resolver-worker`, `packages/core`, `packages/meta-resolver`, `packages/runtime-web`, and `packages/downloader`. Do not inspect unrelated areas unless required by the task.

## Current checkpoint

M7E commit: `4c002ea00bf2ea5862b1328b05ad76317f19d404`, pushed to `origin/main`.

M7A–M7E are complete. Production is deployed and physically confirmed. The working tree was clean after the M7E push; this handoff is committed separately. The next task is not yet defined and should follow new QA findings or product priority.
