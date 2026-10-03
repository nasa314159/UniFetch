# Supported content

| Platform / content | Current support                            |
| ------------------ | ------------------------------------------ |
| Instagram Post     | Fixture/demo: one local original SVG image |
| Instagram Carousel | Fixture/demo: image, image, video, image   |
| Instagram Reel     | Fixture/demo: local original portrait MP4  |
| Instagram Stories  | Not supported                              |
| Facebook           | Planned; host detection only               |
| Threads            | Planned; host detection only               |

Demo IDs are `unifetch-demo-image`, `unifetch-demo-carousel`, and `unifetch-demo-reel`. All authors and captions are fictional. Media was created locally for UniFetch; no third-party copyrighted media is included. Arbitrary real Instagram URLs return a typed error explaining that live resolution is not implemented. Only HTTP(S) URLs on the documented host allowlist are accepted.

There is no audio extraction, transcoding, ZIP export, profile crawling or bulk content discovery. Multiple carousel assets are downloaded individually and sequentially after explicit selection or Download all.
