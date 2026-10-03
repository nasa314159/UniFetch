# Privacy model

UniFetch's local-first goal is processing media users can already access without routing metadata or media through UniFetch-controlled proxy servers. This milestone performs no real platform requests; its metadata is bundled and its generated media is served locally by the application host.

The tool requests no usernames, passwords, cookies, exported browser sessions or authentication tokens. It never collects, uploads, serializes or stores credentials. WebRuntime requests omit credentials and request no-store; cross-origin requests are disallowed in this runtime.

## Storage

Input and shared URLs, resolved posts, authors, captions, asset references and download history live only in memory. No localStorage, IndexedDB or content persistence is used. Future preferences may store only theme, language placeholder or onboarding/install-dismissal state. User download clicks save chosen files using the browser's normal download mechanism.

The service worker caches application shell resources only: HTML, JavaScript, CSS and icons (and local fonts if introduced). It has no runtime caching rules. `/demo/` assets are excluded from precaching, and no user content or post URLs become service-worker cache keys. The shell's fixed demo metadata is fictional application data. ResolutionTrace has an empty network list because resolution is a local lookup; media display and download subsequently request local app assets.

## PWA limitations

Install and share-target availability vary across browsers and OSes. A GET share delivers fields in an initial URL; the app replaces it before resolution, but static-host logs, browser history mechanisms and HTTP caches are outside app control. Configure the host to avoid recording share query data. No guarantee is made that client replacement erases data already observed externally. `/share` navigation fallback is disabled in the service worker to avoid treating content-bearing navigations as shell entries. Static hosting supplies the route when online.

Browsers may require permission for sequential downloads. Downloaded files are intentionally persistent on the user's device. No offline media archive, analytics, telemetry, third-party fonts or tracking pixels are included.
