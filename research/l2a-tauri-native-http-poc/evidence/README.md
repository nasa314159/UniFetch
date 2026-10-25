# L2A evidence

This directory is mostly gitignored. Only sanitized summaries are committed.

Tracked:

- `summary.json` — live run statuses, sizes, hashes, security counts, and stage
  flags. It contains no signed media URLs, cookies, tokens, or headers.
- `security.json` — the 40 local security-boundary checks.

Not tracked (regenerate with `L2A_ALLOW_LIVE=1 pnpm live:evidence`):

- `instagram-raw.json`, `threads-raw.html` — bounded upstream responses; these
  can contain signed CDN URLs.
- `instagram-asset.json`, `threads-asset.json` — parser-selected signed media
  URLs.
- `downloads/*.jpg` — actual saved public media.
- `*-fetch.json`, `*-save.json` — per-stage metadata and file evidence.

The committed summary is the authoritative evidence record for the report at
`docs/l2a-tauri-native-http-poc.md`. Raw responses and media are deliberately
not committed.
