---
# opilot-mkqk
title: 021 Remove deprecated ollama namespace settings declarations
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-dfc1
id: opilot-mkqk
---

Source issue 021 from `docs/plans/remediation-plan.md`.

## Summary

Deprecated `ollama.*` settings are still declared in `package.json`, which keeps obsolete configuration visible after the namespace migration.

## Files

- `package.json`

## Remediation Goal

Retire obsolete settings contributions once migration support no longer depends on them.

## Todo

- [ ] Review the remaining deprecated setting contributions in `package.json`
- [ ] Confirm they are no longer needed for compatibility or user guidance
- [ ] Remove or deprecate them more clearly according to the intended migration policy
- [ ] Validate extension settings UI behavior after the change
- [ ] Update any related documentation if settings names change or disappear
