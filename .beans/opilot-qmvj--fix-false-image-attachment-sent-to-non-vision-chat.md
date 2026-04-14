---
id: opilot-qmvj
title: Fix false image attachment sent to non-vision chat models
status: completed
type: bug
---

ty: high
branch: fix/qmvj-false-image-attachment
pr: 70
created_at: 2026-03-16T19:01:45Z
updated_at: 2026-03-16T19:15:58Z
id: opilot-qmvj

---

Investigate why chat requests to text-only models like qwen3.5:4b can include image inputs and trigger Ollama errors such as `image: unknown format` even when the user did not intentionally send an image. Add coverage and fix the request mapping so only valid image content is forwarded.

## Todo

- [x] Create bean and issue branch
- [x] Trace how chat content is mapped to image inputs
- [x] Add a regression test for text-only requests that carry non-image media metadata
- [x] Fix request mapping so only valid image payloads are forwarded
- [x] Add regression coverage for unsupported binary attachments
- [x] Push branch and open PR
- [x] Run targeted tests and compile validation

## Summary of Changes

- Confirmed that `LanguageModelDataPart` in the VS Code API is generic and can carry image, JSON, text, and other binary payloads.
- Updated `src/provider.ts` so only `image/*` parts are sent through Ollama's `images` field.
- Added decoding for text and JSON data parts so they stay in message content instead of being mislabeled as images.
- Added a regression test covering vision-capable models receiving non-image data parts.
- Added regression coverage proving unsupported binary attachments like PDFs are stripped rather than forwarded as images or decoded as text.
