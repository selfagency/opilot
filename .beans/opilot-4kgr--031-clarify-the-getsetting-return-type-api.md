---
# opilot-4kgr
title: 031 Clarify the getSetting return-type API
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-14T21:40:17Z
parent: opilot-g952
id: opilot-4kgr
---

Source issue 031 from `docs/plans/remediation-plan.md`.

## Summary

The `getSetting` API shape is considered harder to understand than it should be, which adds friction for callers and future maintenance.

## Files

- `src/settings.ts`
- any direct call sites affected by the API refinement

## Remediation Goal

Make the return type and call contract clearer without introducing unnecessary abstraction or breaking consumers unexpectedly.

## Todo

- [ ] Review the current `getSetting` API and identify the main ambiguity for callers
- [ ] Choose the smallest API refinement that improves clarity
- [ ] Update the implementation and any affected call sites
- [ ] Add or update tests to lock in the intended contract
- [ ] Verify the API now reads clearly to a new maintainer
