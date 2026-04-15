---
# opilot-e176
title: 024 Replace deprecated createStatusBarItem overload
status: completed
type: task
priority: low
created_at: 2026-04-14T21:39:33Z
updated_at: 2026-04-15T00:50:00Z
parent: opilot-9ycj
---

Source issue 024 from `docs/plans/remediation-plan.md`.

## Summary

The extension still uses a deprecated `createStatusBarItem` overload, which should be updated to match current VS Code API guidance.

## Files

- `src/statusBar.ts`

## Remediation Goal

Move to the supported API shape without changing status bar behavior or placement unexpectedly.

## Todo

- [x] Locate the deprecated overload usage and confirm the supported replacement signature
- [x] Update the status bar item creation to the current API form
- [x] Verify priority, alignment, and lifecycle behavior remain the same
- [x] Add or update tests if the surrounding abstraction is covered
- [x] Confirm the change removes the deprecation concern cleanly

## Summary of Changes

- Updated status bar item creation in `src/statusBar.ts` to use the supported API form:
  - from `createStatusBarItem(alignment, priority)`
  - to `createStatusBarItem('opilot.status', alignment, priority)`
- Preserved alignment (`Right`), priority (`100`), command binding, and lifecycle behavior.

Validation run:

- `pnpm vitest run src/statusBar.test.ts`
- `pnpm run compile`
