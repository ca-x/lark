# Fixture provenance

- `demo/index.js`: MyGo Music official example from `egoist/mygo-music`, commit `cb5e4cc49f8d4774d3a57b993e5b53c89b5a8f73`, `examples/demo-plugin/index.js`; AGPL-3.0. The project license is retained at the repository root as `LICENSE`.
- Optional Li Zhi interoperability test: `djyde/mygo-lizhi`, commit `87b97fd99a8453c56af5a768ce48a3454305f869`, `index.js`. This repository has no redistribution license, so its source is **not vendored**. Set `LARK_MYGO_LIZHI_FIXTURE` to a locally reviewed source file to run the opt-in test with mocked HTTP responses. No music, artwork, credentials or third-party user data is included.

Tests exercise actual module exports rather than a rewritten imitation. These fixtures are not enabled or installed in production and do not establish compatibility with every MyGo plugin or live service.
