---
# opilot-xdu8
title: 017 Stop refreshing the sidebar tree on every tooltip update
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-wn59
id: opilot-xdu8
---

Source issue 017 from `docs/plans/remediation-plan.md`.

## Summary

The sidebar refreshes more often than necessary during tooltip updates, which can create avoidable UI churn.

## Files

- `src/sidebar.ts`

## Remediation Goal

Limit tree refreshes to meaningful state changes instead of incidental tooltip mutations.

## Todo

- [ ] Trace the tooltip update path and current refresh triggers
- [ ] Separate visual metadata updates from structural tree refresh conditions
- [ ] Implement a narrower refresh strategy or debounce if appropriate
- [ ] Add tests or instrumentation for refresh-trigger behavior
- [ ] Verify the sidebar remains responsive without unnecessary redraws
