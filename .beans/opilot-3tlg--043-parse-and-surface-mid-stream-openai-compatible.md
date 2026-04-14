---
# opilot-3tlg
title: 043 Parse and surface mid stream OpenAI compatible errors
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:18Z
updated_at: 2026-04-14T21:40:18Z
parent: opilot-itbr
id: opilot-3tlg
---

Source issue 043 from `docs/plans/remediation-plan.md`.

## Summary

The OpenAI-compatible layer should detect NDJSON mid-stream error objects and surface them instead of treating them as ordinary output or opaque failures.

## Files

- `src/openaiCompat.ts`

## Remediation Goal

Recognize mid-stream error payloads explicitly and translate them into clear diagnostics or failure handling.

## Todo

- [ ] Review the current stream parsing path for OpenAI-compatible responses
- [ ] Identify how mid-stream error objects are represented and currently handled
- [ ] Add explicit error detection and propagation for NDJSON error chunks
- [ ] Add tests covering normal chunks, partial output, and mid-stream error payloads
- [ ] Verify users receive clear error messages when the upstream stream reports failure
