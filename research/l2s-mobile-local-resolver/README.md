# L2S — Mobile Local Resolver Feasibility (research)

**Status:** CONDITIONAL GO to a device-gated iOS Shortcut experiment and a
diagnostics/fallback milestone; NO-GO for a zero-install Android local
transport.

This directory contains only the L2S Shortcut source and build tooling. The full
research report, evidence classification, security analysis, UX comparison, and
real-device checklist are in
[`docs/l2s-mobile-local-resolver-feasibility.md`](../../docs/l2s-mobile-local-resolver-feasibility.md).

## Contents

```text
shortcut/
  build_shortcut.py             # Generates and optionally signs the Shortcut
  UniFetch-L2S-Experimental.xml # Reviewable generated workflow
  README.md                     # Build, import, variants, and known risks
```

The signed `.shortcut` is generated to `artifacts/` and is not committed.

## What this is

A transport-only fast path:

```text
Share -> validate -> anonymous bootstrap GET -> csrftoken
       -> fixed GraphQL POST -> raw public JSON
       -> clipboard -> /import#url=... (existing TS parser)
       -> preview -> direct CDN download
```

If the native path does not return JSON, the Shortcut opens the existing
`/share?url=...` Worker flow. It does not read account cookies, log in, download
media, or send metadata to UniFetch.

## What this is not

- Not a second Instagram parser.
- Not an Android solution.
- Not a replacement for the Cloudflare Worker.
- Not validated on an iPhone or iPad.
- Not a production change. Nothing in this directory is deployed.

## Reproduce

```sh
cd shortcut
python3 build_shortcut.py
plutil -lint UniFetch-L2S-Experimental.xml
python3 build_shortcut.py --sign
```

The generated XML passed the community Shortcuts Playground validator. The
signed archive was produced with Apple's `shortcuts sign`. Neither proves that
the Shortcut imports or runs on iOS. Use the checklist in the report.
