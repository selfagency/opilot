---
# opilot-d7kb
title: 010 Wrap streaming iteration in graceful error handling
status: todo
type: bug
priority: normal
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-nqwd
id: opilot-d7kb
---

Source issue 010 from `docs/plans/remediation-plan.md`.

## Summary

Streaming loops in the chat participant and language model provider can fail mid-iteration without graceful handling.

## Files

- `src/extension.ts`
- `src/provider.ts`

## Remediation Goal

Catch stream errors during iteration, flush any safe partial output, and surface an appropriate user-facing failure mode.

## Todo

- [ ] Review all `for await` streaming loops used for Ollama responses
- [ ] Add guarded iteration with context-appropriate error reporting for both consumers
- [ ] Preserve cancellation handling and partial output behavior where sensible
- [ ] Add or update tests for disconnect, server-error, and cancellation scenarios
- [ ] Verify failed streams no longer surface as opaque unhandled errors
