# Threat model

## Trust boundary

UniFetch acts only on one explicitly supplied URL after a Resolve click or explicit OS share. It saves assets only after an explicit download click. It does not crawl profiles, enumerate content, brute-force identifiers, discover unavailable posts, bypass private-account restrictions or authentication/access controls, request credentials, export/upload cookies, or serialize browser sessions. No live platform resolver exists in this milestone.

## Threats and reductions

| Threat                                                             | Reduction in this implementation                                                                                                                                           |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malicious third-party downloader server observes media or browsing | No backend/media proxy, cloud API or third-party download service. Fixture resolution performs no network requests.                                                        |
| Accidental credential leakage                                      | No credential inputs or session handling; URL userinfo rejected; runtime omits credentials and blocks cross-origin requests.                                               |
| Persistent content history                                         | No content persistence or analytics; only transient state. Service worker excludes media and has no runtime caching.                                                       |
| Overbroad URL handling                                             | Exact host allowlist; HTTP(S) only; ports/userinfo rejected; known tracking removed, unknown parameters preserved. Registry handles one URL, and fixtures use exact paths. |
| XSS / unsafe schemes                                               | Vue text interpolation, no raw HTML; protocol validation in input/share parser; generated local assets only; downloader enforces same-origin `/demo/` HTTP(S) URLs.        |
| Unexpected application errors leak internals                       | Safe typed error messages and diagnostic codes; no raw stacks in UI.                                                                                                       |
| Share payload persists in visible address                          | Route replacement before resolution; no permanent storage. Host and browser may still observe initial GET data.                                                            |

## Remaining limitations

Static hosts and browsers control network logs, browser HTTP caches and download behavior. A compromised app host or dependency could change executable code; open source enables auditing but does not prove any deployed build trustworthy. Application JavaScript precaches fixed fictional demo metadata. Runtime contracts do not certify future live resolvers: those require separate security/privacy review and accurate trace records. Installing the PWA does not grant new platform access or bypass CORS.
