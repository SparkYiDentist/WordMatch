# WordMatch Kokoro pronunciation package

This directory is a generated deployment artifact. It is intentionally outside
`miniprogram/`, so it is not included in the WeChat mini-program package.

- Entries: 7481 / 7481
- Audio bytes: 19265904
- Format: mp3, mono, 24 kbps
- Engine: kokoro-onnx 0.6.0
- Model: Kokoro-82M v1.0 fp16
- Voice: af_heart (en-us)

Upload this directory to HTTPS static storage/CDN and keep `manifest.json` next
to the `audio/` directory. Runtime clients should resolve a normalized English
word through `manifest.json` and download/cache only the requested MP3.

Kokoro-82M is licensed under Apache-2.0. See the repository root
`THIRD_PARTY_NOTICES.md` for provenance and license links.
