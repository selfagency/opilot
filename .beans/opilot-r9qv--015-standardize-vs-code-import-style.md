---
# opilot-r9qv
title: 015 Standardize VS Code import style
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-qi3q
id: opilot-r9qv
---

Source issue 015 from `docs/plans/remediation-plan.md`.

## Summary

VS Code types are imported inconsistently across the codebase, which adds friction and weakens readability.

## Files

- Multiple files using VS Code imports

## Remediation Goal

Adopt a consistent import style for VS Code APIs and types that matches the prevailing project convention.

## Todo

- [ ] Identify the current import patterns used for VS Code symbols
- [ ] Choose the preferred style based on existing repository conventions
- [ ] Normalize the affected files with minimal unrelated churn
- [ ] Verify the build output and linting remain clean
- [ ] Document the preferred pattern if it is not already obvious
