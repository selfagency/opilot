---
# opilot-rv60
title: 030 Add an overall timeout strategy for chat request handling
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:33Z
updated_at: 2026-04-14T21:39:33Z
parent: opilot-1poi
id: opilot-rv60
---

Source issue 030 from `docs/plans/remediation-plan.md`.

## Summary

Chat request handling lacks an overall timeout boundary, which can leave long-running operations without a clear end condition.

## Files

- `src/extension.ts`

## Remediation Goal

Define whether and how chat requests should time out so the user experience remains predictable during hangs or long stalls.

## Todo

- [ ] Review the current chat request lifecycle and existing cancellation behavior
- [ ] Decide on an explicit timeout policy or document why one should not be enforced
- [ ] Implement the timeout or guardrail if the policy calls for it
- [ ] Add tests for long-running or stalled request scenarios
- [ ] Verify timeout behavior does not fight normal streaming or user cancellation
