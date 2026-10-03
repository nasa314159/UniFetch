# Privacy model

UniFetch's local-first goal is processing media users can already access without routing metadata or media through UniFetch-controlled proxy servers. Demo metadata is bundled and its generated media is served locally by the application host. M4C routes other explicitly supplied supported URLs through direct Instagram acquisition; the existing WebRuntime rejects inaccessible cross-origin session context before bootstrap from the local app origin. There is no remote proxy fallback.

The tool requests no usernames, passwords, cookies, exported browser sessions or authentication tokens. It never collects, uploads, serializes or stores credentials. Ordinary WebRuntime requests omit credentials and request no-store; cross-origin requests are disallowed in this runtime. The optional M4B origin-session capability can use browser-owned same-origin credentials and internal CSRF injection, without exporting cookies or persisting tokens. It rejects inaccessible cross-origin session context; the production live path now invokes this capability and surfaces `BROWSER_RESTRICTION` without a successful result.

## Storage

Input and shared URLs, resolved posts, authors, captions, asset references and download history live only in memory. No localStorage, IndexedDB or content persistence is used. Future preferences may store only theme, language placeholder or onboarding/install-dismissal state. User download clicks save chosen files using the browser's normal download mechanism.

The service worker caches application shell resources only: HTML, JavaScript, CSS and icons (and local fonts if introduced). It has no runtime caching rules. `/demo/` assets are excluded from precaching, and no user content or post URLs become service-worker cache keys. The shell's fixed demo metadata is fictional application data. Fixture ResolutionTrace has an empty network list because resolution is a local lookup; fixture previews and downloads subsequently request local app assets. Successful live composition would use acquisition origin records and keep processedLocally=true, remoteProxyUsed=false and credentialsExported=false. Browser-restricted attempts do not fabricate a successful trace. Live response data is never persisted or intentionally cached.

## PWA limitations

Install and share-target availability vary across browsers and OSes. A GET share delivers fields in an initial URL; the app replaces it before resolution, but static-host logs, browser history mechanisms and HTTP caches are outside app control. Configure the host to avoid recording share query data. No guarantee is made that client replacement erases data already observed externally. `/share` navigation fallback is disabled in the service worker to avoid treating content-bearing navigations as shell entries. Static hosting supplies the route when online.

Browsers may require permission for sequential downloads. Downloaded files are intentionally persistent on the user's device. No offline media archive, analytics, telemetry, third-party fonts or tracking pixels are included.

The dev-only three-URL manual probe clears form inputs on submission, returns only high-level statuses or asset counts/types, and writes no inputs, outputs or credentials to application storage or logs. It is excluded from production builds. Real-browser checks and three user-supplied public image/carousel/Reel probes each observed BROWSER_RESTRICTION. No live success is claimed, and no live download was tested. Public inputs were used only transiently and are not included in repository files.
