---
# opilot-woor
title: 039 Respect silent mode during language model discovery
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:18Z
updated_at: 2026-04-14T21:40:18Z
parent: opilot-itbr
id: opilot-woor
---

Source issue 039 from `docs/plans/remediation-plan.md`.

## Summary

`provideLanguageModelChatInformation` should honor silent mode so model discovery does not prompt users unexpectedly.

## Files

- `src/provider.ts`

## Remediation Goal

Ensure model enumeration behaves quietly when silent discovery is requested.

## Todo

- [ ] Review current provider discovery behavior and identify prompt-producing paths
- [ ] Check how silent mode is surfaced by the VS Code API in this flow
- [ ] Update discovery logic to suppress prompts or interactive recovery when silent mode is enabled
- [ ] Add tests for silent and interactive discovery scenarios
- [ ] Verify normal discovery still works when silent mode is not requested
