---
# opilot-5lxl
title: 003 Split extension.ts into focused modules
status: todo
type: task
priority: low
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-1ubu
id: opilot-5lxl
---

Source issue 003 from `docs/plans/remediation-plan.md`.

## Summary

`src/extension.ts` is overly large and mixes activation, chat handling, diagnostics, conflict management, and log-streaming responsibilities.

## Files

- `src/extension.ts`
- candidate extracted modules such as `src/chatParticipant.ts`, `src/connectionManager.ts`, and `src/logStreamer.ts`

## Remediation Goal

Reduce file size and responsibility sprawl by extracting cohesive internal modules while preserving the existing activation entry point.

## Todo

- [ ] Identify coherent seams for extraction based on current responsibilities
- [ ] Define a small activation/orchestration surface that remains in `extension.ts`
- [ ] Extract one responsibility group at a time with minimal behavior changes
- [ ] Update tests or add characterization coverage to guard against regressions
- [ ] Verify the final module boundaries improve readability without breaking activation flow
