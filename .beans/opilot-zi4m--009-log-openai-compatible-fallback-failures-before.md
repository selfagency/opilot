---
# opilot-zi4m
title: 009 Log OpenAI-compatible fallback failures before native fallback
status: todo
type: bug
priority: normal
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-nqwd
id: opilot-zi4m
---

Source issue 009 from `docs/plans/remediation-plan.md`.

## Summary

OpenAI-compatible transport failures currently fall back silently, which makes configuration and compatibility problems difficult to diagnose.

## Files

- `src/extension.ts`

## Remediation Goal

Log the fallback reason clearly enough for developers and users to understand what failed without degrading the recovery path.

## Todo

- [ ] Identify the silent fallback catch blocks in the OpenAI-compatible chat paths
- [ ] Add warning-level diagnostics that explain why fallback was triggered
- [ ] Ensure logged details are safe and do not leak secrets or excessive payload data
- [ ] Add or update tests that exercise fallback logging behavior
- [ ] Verify fallback still works while surfacing actionable diagnostics
