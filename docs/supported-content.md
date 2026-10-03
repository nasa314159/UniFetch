# Supported content

| Platform / content | Current support                            |
| ------------------ | ------------------------------------------ |
| Instagram Post     | Fixture/demo: one local original SVG image |
| Instagram Carousel | Fixture/demo: image, image, video, image   |
| Instagram Reel     | Fixture/demo: local original portrait MP4  |
| Instagram Stories  | Not supported                              |
| Facebook           | Planned; host detection only               |
| Threads            | Planned; host detection only               |

Demo IDs are `unifetch-demo-image`, `unifetch-demo-carousel`, and `unifetch-demo-reel`. All authors and captions are fictional. Media was created locally for UniFetch; no third-party copyrighted media is included. Other Instagram `/p/`, `/reel/` and `/reels/` URLs now enter the live acquisition → parser → normalizer pipeline. Real-browser synthetic supported-path checks returned `BROWSER_RESTRICTION` because WebRuntime cannot access the cross-origin Instagram session context. Manual probes for one user-supplied public image post, one carousel and one Reel each returned `BROWSER_RESTRICTION`. None succeeded and no live download was tested. There is no server proxy fallback; demo mode remains available. Only HTTP(S) URLs on the documented host allowlist are accepted.

There is no audio extraction, transcoding, ZIP export, profile crawling or bulk content discovery. Multiple carousel assets are downloaded individually and sequentially after explicit selection or Download all.

Broader local resolution capability may require a future ExtensionRuntime or NativeRuntime. Neither is implemented. Live-capable mocked runtime tests cover image, mixed carousel and Reel composition; they do not establish production Instagram support.
