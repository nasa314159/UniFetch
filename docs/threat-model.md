# Threat model

## Trust boundary

UniFetch acts on one explicit URL after a Resolve click or OS share. Media saves require a download click. It does not crawl, enumerate, brute-force IDs, bypass access controls/private restrictions, discover unavailable content, request Instagram credentials, export user cookies or serialize browser sessions.

M5 introduces a remote metadata trust boundary: the configured Resolver sees the submitted public URL and upstream metadata transiently. It cannot be described as fully local. Media bytes remain between the client and source/CDN. The public implementation is auditable; an operator could deploy modified code, so users must trust the actual deployment as well as review source.

## Threats and reductions

| Threat                                                 | Reduction                                                                                                                                                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious downloader server observes media or browsing | No media relay routes or media-body fetch; remote metadata visibility is disclosed. Only one explicitly submitted URL is processed. Deployment trust remains necessary.                                                                 |
| SSRF / arbitrary outbound destinations                 | HTTPS Instagram content-reference parsing; exact hosts, no userinfo/custom ports; fixed runtime bootstrap/metadata destinations; redirects disabled. Raw user URL is never fetched.                                                     |
| Credential leakage                                     | No credential inputs/accounts; strict JSON schema and rejected Cookie/Authorization; credentials-omit client; anonymous upstream cookie/CSRF context stays in one runtime closure and is discarded. No token/raw-header output/logging. |
| Persistent content history                             | No app history or storage bindings; no-store upstream/API; shell-only service worker; no analytics/telemetry. Infrastructure logs and browser caches need separate operator review.                                                     |
| Resource exhaustion / unexpected structures            | POST JSON only, 4 KiB streamed-body cap, one URL, fixed requests, upstream timeouts, 1 MiB metadata cap, strict normalized response capped at 100 assets. No enumeration/retries. No persistent rate-limit database is added.           |
| XSS / unsafe URL schemes                               | Vue escaped text, no raw HTML; exact input/share protocols/hosts; safe HTTP(S) direct asset URLs; API schema validation; no raw upstream response exposed. Third-party media origins still see direct requests.                         |
| Internal diagnostics leakage                           | Typed safe code/message only; no stack, upstream error dump, cookies, headers or CSRF in API/UI.                                                                                                                                        |
| Unwanted browser credential forwarding                 | Explicit origin CORS without credentials, strict preflight headers, credential-free API fetch and no UniFetch cookies/sessions.                                                                                                         |
| Share data in address/history                          | Replace query before resolution; no app persistence. Initial GET can still be observed by browser/host.                                                                                                                                 |

## Remaining risks

The supplied Instagram web profile is unstable and may require authentication, be rate-limited or fail schema parsing. Failures stay typed; no alternate endpoint, login or proxy workaround is used. Direct media can be blocked by source/browser policy. A compromised dependency/host can change executable behavior. Provider logs, browser cache/history and download behavior are beyond application guarantees. No account-based access or persistent abuse-control database is introduced; operators should assess exposure before deployment.

M4C public Image/Carousel/Reel direct probes each returned BROWSER_RESTRICTION; M4D was intentionally skipped. Neither extensions nor native runtimes are implemented.
