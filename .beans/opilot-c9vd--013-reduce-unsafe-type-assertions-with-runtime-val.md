---
# opilot-c9vd
title: 013 Reduce unsafe type assertions with runtime validation
status: todo
type: task
priority: normal
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-qi3q
id: opilot-c9vd
---

Source issue 013 from `docs/plans/remediation-plan.md`.

## Summary

Several modules rely heavily on `as` assertions without validating the runtime shape first, weakening type safety and making failures less predictable.

## Files

- Multiple files identified during implementation

## Remediation Goal

Replace assertion-heavy boundaries with narrow validation helpers or better-typed abstractions where the runtime shape is not guaranteed.

## Todo

- [ ] Inventory the highest-risk `as` assertions in production paths
- [ ] Group them by boundary type such as config, API response, or VS Code payload
- [ ] Introduce runtime checks or typed helpers for the riskiest cases
- [ ] Add tests for malformed or partial input shapes
- [ ] Verify the resulting code reduces unsafe assertions without excessive noise
