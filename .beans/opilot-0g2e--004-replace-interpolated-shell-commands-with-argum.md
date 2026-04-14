---
# opilot-0g2e
title: 004 Replace interpolated shell commands with argument arrays
status: todo
type: bug
priority: normal
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-yva4
id: opilot-0g2e
---

Source issue 004 from `docs/plans/remediation-plan.md`.

## Summary

`src/sidebar.ts` constructs process-kill commands with string interpolation. The current PID source is constrained, but the pattern is still fragile and avoidable.

## Files

- `src/sidebar.ts`

## Remediation Goal

Use non-shell execution with explicit argument arrays so process identifiers are never interpreted as shell syntax.

## Todo

- [ ] Locate all shell-command construction paths related to force-kill behavior
- [ ] Replace interpolated command strings with safe process execution APIs and argument arrays
- [ ] Ensure Windows and Unix implementations both preserve current behavior
- [ ] Add or update tests for the command construction and execution path
- [ ] Verify no remaining process-control commands rely on shell interpolation
