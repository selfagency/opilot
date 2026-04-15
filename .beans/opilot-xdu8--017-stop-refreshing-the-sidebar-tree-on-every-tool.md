---
# opilot-xdu8
title: 017 Stop refreshing the sidebar tree on every tooltip update
status: completed
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-15T13:36:19Z
parent: opilot-wn59
---

Source issue 017 from `docs/plans/remediation-plan.md`.

## Summary

The sidebar refreshes more often than necessary during tooltip updates, which can create avoidable UI churn.

## Files

- `src/sidebar.ts`

## Remediation Goal

Limit tree refreshes to meaningful state changes instead of incidental tooltip mutations.

## Todo

- [x] Trace the tooltip update path and current refresh triggers
- [x] Separate visual metadata updates from structural tree refresh conditions
- [x] Implement a narrower refresh strategy or debounce if appropriate
- [x] Add tests or instrumentation for refresh-trigger behavior
- [x] Verify the sidebar remains responsive without unnecessary redraws

## Summary of Changes

- Added `updateItemTooltip(...)` helper in `src/sidebar.ts` to avoid firing item-level tree updates when tooltip text is unchanged.
- Applied conditional tooltip refreshes across asynchronous tooltip-update paths for local/library/cloud model entries.
- This preserves existing tooltip enrichment behavior while reducing unnecessary UI redraw events.

Validation run:

- `pnpm vitest run src/sidebar.test.ts src/sidebar.utils.test.ts`
- `pnpm run compile`
