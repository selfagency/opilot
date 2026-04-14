---
# opilot-cu2n
title: 002 Consolidate duplicated formatBytes helpers
status: todo
type: task
priority: normal
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-1ubu
id: opilot-cu2n
---

Source issue 002 from `docs/plans/remediation-plan.md`.

## Summary

`formatBytes()` exists in multiple modules with inconsistent formatting behavior, which creates UI inconsistency and duplicate logic.

## Files

- `src/extension.ts`
- `src/statusBar.ts`
- `src/sidebar.ts`
- new shared formatter module such as `src/formatUtils.ts`

## Remediation Goal

Replace the duplicated implementations with one reusable formatter that supports the precision needed by each caller.

## Todo

- [ ] Compare the existing `formatBytes()` variants and document required output differences
- [ ] Create a shared formatter API that handles precision and suffix needs explicitly
- [ ] Replace the duplicated helpers with imports from the shared module
- [ ] Add focused tests for zero, small, large, and edge-case values
- [ ] Verify the affected UI surfaces now present sizes consistently
