---
# opilot-o64p
title: 001 Extract duplicated chat utilities into a shared module
status: todo
type: task
priority: high
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-1ubu
id: opilot-o64p
---

Source issue 001 from `docs/plans/remediation-plan.md`.

## Summary

Six chat utility functions are duplicated across `src/extension.ts` and `src/provider.ts`, creating a high-risk maintenance hotspot.

## Files

- `src/extension.ts`
- `src/provider.ts`
- new shared module such as `src/chatUtils.ts`

## Remediation Goal

Consolidate the duplicated helpers into a single tested module so both call sites share behavior and future fixes land once.

## Todo

- [ ] Identify the exact duplicated functions and current call signatures
- [ ] Design the shared module API with minimal churn for both consumers
- [ ] Move the shared logic into a common module and update imports
- [ ] Add or update unit tests covering fallback, streaming, and tool-call mapping behavior
- [ ] Verify behavior remains unchanged for both the chat participant and LM provider
