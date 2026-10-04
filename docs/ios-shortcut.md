# UniFetch iOS Share Shortcut

Installed iOS PWAs do not appear directly in Instagram’s Share Sheet. The iOS Shortcut forwards an explicitly shared link into UniFetch. It does not resolve posts or download media. Android's PWA Share Target is unchanged.

[Add UniFetch Shortcut](https://www.icloud.com/shortcuts/9ff25727f16a43cfa6eac1e3ccd49a82) on your iPhone, then confirm adding it in Shortcuts. This shared Shortcut has been validated on a physical iPhone: it appears in Instagram’s Share Sheet, transfers the URL, opens UniFetch, and automatically resolves a real carousel.

## Manual setup fallback

If the iCloud link is unavailable, build the same bridge manually:

1. In Apple's **Shortcuts** app, create a shortcut named **UniFetch**.
2. In **Details**, enable **Show in Share Sheet**. Accept **URLs**, **Safari web pages**, and **Text**. Set **If there's no input** to **Continue**.
3. Add **Get URLs from Input**, input **Shortcut Input**.
4. Add **If URLs does not have any value** → **Show Alert** with `UniFetch couldn't find a supported Instagram link in the shared item.` → **Stop and Output** with no output (**Do Nothing**). End If. This guards empty input before selecting an item.
5. Add **Get Item from List**, choose **First Item** from **URLs**.
6. Add **Match Text** on **Item from List**, with this pattern:

   ```text
   (?i)^https://(?:www\.)?instagram\.com/(?:p|reel|reels)/[A-Za-z0-9_-]+/?(?:\?[^\s#]*)?(?:#[^\s]*)?$
   ```

7. Add **If Matches has any value**. Inside If, add **URL Encode** → **Encode**, input **Matches**.
8. Still inside If, add **Text**: type `https://unifetch.pages.dev/share?url=` and insert the **URL Encoded Text** variable immediately after `=`. Insert the variable token, not its literal name. Encode only the Instagram URL, once.
9. Add **Open URLs**, input **Text**. In Otherwise, use **Show Alert**: `UniFetch couldn't find a supported Instagram link in the shared item.` End after End If. Empty input or an unsupported first URL must show the alert rather than open an empty page.

Flow: **Receive Share Sheet input → extract first URL → validate → URL-encode → open `https://unifetch.pages.dev/share?url=<encoded URL>`**. UniFetch handles normalization, scrubs the visible share query before resolution, and resolves automatically without another Resolve tap.

Supported links: HTTPS `instagram.com` or `www.instagram.com`, with `/p/`, `/reel/`, or `/reels/` and a shortcode. Tracking queries are allowed; UniFetch remains responsible for normalization.

To use it, share a public Instagram Post/Reel through the iOS Share Sheet and select **UniFetch**. If missing, check Show in Share Sheet/input types and scroll through the actions; Instagram's own share panel may have a separate Share option. Edit Actions / Favorites can move it higher. Safari may open instead of the installed PWA; forcing the PWA is not promised.

The Shortcut's variables are transient. Do not add clipboard, Notes, Files, history, logging, or network-fetch actions. It requires no Instagram/Apple credentials and exports no cookies. Metadata and browser-direct media retain the existing trust model. Browser history/host logs are outside application control. The iCloud link uses Apple’s Shortcut sharing; UniFetch does not generate a `.shortcut` binary.

## Troubleshooting

- **UniFetch is missing:** enable Show in Share Sheet in the Shortcut’s Details.
- **No Instagram URL:** accept URLs, Safari web pages, and Text; the first extracted URL must be a supported Instagram link.
- **Opens without resolving:** check Text starts with `https://unifetch.pages.dev/share?url=` and contains the URL Encoded Text variable token, encoded once.
- **Action is buried:** use Edit Actions / Favorites where iOS permits to move UniFetch higher.
