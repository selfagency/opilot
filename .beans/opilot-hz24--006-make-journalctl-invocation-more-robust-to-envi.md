---
# opilot-hz24
title: 006 Make journalctl invocation more robust to environment differences
status: todo
type: task
priority: low
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-yva4
id: opilot-hz24
---

Source issue 006 from `docs/plans/remediation-plan.md`.

## Summary

The current `journalctl` execution path assumes command availability via PATH, which may fail silently or confusingly on systems with different environments.

## Files

- `src/sidebar.ts`

## Remediation Goal

Detect command availability more explicitly and fail gracefully when the expected logging tools are unavailable.

## Todo

- [ ] Review how `journalctl` is located and invoked today
- [ ] Add explicit availability detection or fallback behavior before execution
- [ ] Improve user-facing diagnostics when the command is unavailable
- [ ] Add or update tests for supported and unsupported environments
- [ ] Verify Linux log streaming still works normally when the command exists
