---
# opilot-e176
title: 024 Replace deprecated createStatusBarItem overload
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:33Z
updated_at: 2026-04-14T21:39:33Z
parent: opilot-9ycj
id: opilot-e176
---

Source issue 024 from `docs/plans/remediation-plan.md`.

## Summary

The extension still uses a deprecated `createStatusBarItem` overload, which should be updated to match current VS Code API guidance.

## Files

- `src/statusBar.ts`

## Remediation Goal

Move to the supported API shape without changing status bar behavior or placement unexpectedly.

## Todo

- [ ] Locate the deprecated overload usage and confirm the supported replacement signature
- [ ] Update the status bar item creation to the current API form
- [ ] Verify priority, alignment, and lifecycle behavior remain the same
- [ ] Add or update tests if the surrounding abstraction is covered
- [ ] Confirm the change removes the deprecation concern cleanly
