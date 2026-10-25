# UniFetch L2S — Experimental iOS/iPadOS Shortcut

**Status: EXPERIMENTAL — NOT VALIDATED ON AN IPHONE OR IPAD.**

This directory contains the textual source and build tooling for the L2S
native-transport experiment. The shortcut is a **transport-only fast path**. It
does not contain a second Instagram parser and it does not export account
cookies.

```text
Share Sheet
  -> validate one Instagram post/Reel URL
  -> GET https://www.instagram.com/            (anonymous bootstrap)
  -> extract the public csrftoken
  -> POST https://www.instagram.com/graphql/query
       Cookie: csrftoken=<token>
       X-CSRFToken: <token>
       JSON body: doc_id + variables + server_timestamps
  -> if the response starts with "{":
       copy the bounded public JSON to the clipboard
       open https://unifetch.pages.dev/import#url=<encoded canonical URL>
     else:
       open https://unifetch.pages.dev/share?url=<encoded URL>
       (the existing Cloudflare Worker flow)
```

The `/import` Web route is **not implemented in L2S**. It is specified in
`docs/l2s-mobile-local-resolver-feasibility.md` and is the first task of the
recommended L2T milestone. Until that route exists, the `import` branch will
land on the normal UniFetch home page and the clipboard is not consumed.

## Files

| File                                                  | Purpose                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `build_shortcut.py`                                   | Generates the workflow plist; optionally signs it with Apple's `shortcuts` CLI. |
| `UniFetch-L2S-Experimental.xml`                       | Generated, reviewable XML plist (textual source).                               |
| `../../docs/l2s-mobile-local-resolver-feasibility.md` | Full research report, security analysis, and validation checklist.              |

The signed binary is written to `artifacts/UniFetch-L2S-Experimental.shortcut`.
`artifacts/` is gitignored. The signed binary is **not** committed because
signing is local and not reproducible.

## Build

```sh
cd research/l2s-mobile-local-resolver/shortcut
python3 build_shortcut.py             # XML only
python3 build_shortcut.py --sign      # XML + signed .shortcut in artifacts/
```

Signing requirements:

- macOS with the Shortcuts app installed.
- Apple's `shortcuts sign` command (`/usr/bin/shortcuts`).
- `--mode anyone` is used so a tester can import the file. Use
  `--mode people-who-know-me` for a private test by editing the script.

The generated XML passed the community [Shortcuts Playground](https://github.com/viticci/shortcuts-playground-plugin)
validator with `--target-macos 27 --target-platform ios`, and the signed archive
was produced by Apple's `shortcuts sign`. Passing those checks does **not**
prove that the shortcut imports or runs on iOS. A real-device test is required.

Expected build output for the checked-in source (local signing may differ
because the signature is not reproducible):

```text
artifacts/UniFetch-L2S-Experimental.shortcut
size:   26,682 bytes (one local build)
sha256: a874dd9edfddd80afd671ac3dca8840b97d690ca97d9d051d565702176e561cb
```

## Import and first run

1. Transfer the signed `.shortcut` to the iPhone/iPad with AirDrop, Files, or
   iCloud Drive.
2. Open it in Shortcuts and tap **Add Shortcut**.
3. Review the actions before running. The shortcut must contain only:
   share input, text matching, one bootstrap GET, one GraphQL POST, clipboard,
   URL building, and Open URL. It must not contain contacts, photos, files,
   shell, or account-login actions.
4. In the shortcut's **Details**, confirm **Show in Share Sheet** and accept
   URLs, Safari web pages, and Text. If there is no input, choose **Continue**.
5. Delete any older shortcut with the same name before importing a new build;
   the Shortcuts CLI has no import/delete subcommand and duplicate names can be
   skipped silently.
6. Test with a public Instagram image post first. If the native path works, the
   shortcut copies JSON and opens `/import#url=...`. If it fails, it opens the
   existing `/share?url=...` Worker flow.

If the import fails or an action is red, do not force it. Use the manual build
steps in the L2S report, which mirror the generated action graph. The most
likely manual fixes are:

- Set the GraphQL body to **JSON** with `doc_id`, `variables` (nested
  dictionary), and `server_timestamps` if the **File** body pattern does not
  render on the target OS.
- Remove the explicit `Cookie` header and rely on Shortcuts' cookie sharing if
  the OS rejects a manually set `Cookie` header.
- Replace the bootstrap HTML regex with **Get Headers of URL** and read
  `Set-Cookie` if the HTML token is not found.

Each of these changes is a real behavioral variant. Record which one was used in
the device test.

## What this shortcut does not do

- It does not read, export, or forward `sessionid`, `ds_user_id`, or any
  Instagram account cookie.
- It does not log in, solve a challenge, rotate proxies, retry for evasion, or
  spoof a TLS fingerprint.
- It does not download media. Media still goes directly from the source CDN to
  the browser/device after the existing preview.
- It does not send metadata to UniFetch. The clipboard handoff is local.
- It does not replace the Worker for ordinary users. The Worker is the fallback
  and the only path for Android.

## Known risks that require a device test

1. Stock **Get Contents of URL** does not expose HTTP status or response
   headers. The shortcut only knows whether the body starts with `{`.
2. Stock Shortcuts has no explicit timeout or redirect control.
3. It is not documented whether a manually set `Cookie` header is merged with,
   or overridden by, Shortcuts' own cookie jar. A duplicate `csrftoken` could
   fail.
4. It is not documented whether cookies persist between separate runs, only
   within one run (community evidence).
5. `Get Contents of URL` may cache the bootstrap HTML. The shortcut sends
   `Cache-Control: no-cache`, but Shortcuts may ignore it.
6. iOS iCloud Private Relay, a VPN, or a corporate network can change the
   device egress and may reproduce the same upstream refusal as the Worker.
7. `Open URL` opens Safari or the user's default browser, not necessarily the
   installed home-screen PWA.
8. Reading the clipboard in Safari requires a user gesture and may show a paste
   permission prompt.
9. A full carousel JSON payload may be large. The clipboard path is chosen
   precisely because a `#fragment` URL is limited by browser/OS URL length.
