---
# opilot-u9zm
title: 012 Surface task_complete tool-call failures instead of ignoring them
status: todo
type: bug
priority: low
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-nqwd
id: opilot-u9zm
---

Source issue 012 from `docs/plans/remediation-plan.md`.

## Summary

Errors from the `task_complete` tool call are silently ignored, which can hide workflow failures and make agentic runs harder to understand.

## Files

- `src/extension.ts`

## Remediation Goal

Handle `task_complete` failures explicitly so the run can report what happened and recover or stop intentionally.

## Todo

- [ ] Locate the existing `task_complete` error-swallowing path
- [ ] Decide whether failures should warn, fail the request, or annotate the chat output
- [ ] Implement explicit handling with appropriate diagnostics
- [ ] Add tests covering successful and failed completion-tool flows
- [ ] Verify agentic chat runs no longer lose these failures silently
