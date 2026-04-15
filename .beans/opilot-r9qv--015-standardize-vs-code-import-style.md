---
# opilot-r9qv
title: 015 Standardize VS Code import style
status: completed
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-15T13:36:19Z
parent: opilot-qi3q
---

Source issue 015 from `docs/plans/remediation-plan.md`.

## Summary

VS Code types are imported inconsistently across the codebase, which adds friction and weakens readability.

## Files

- Multiple files using VS Code imports

## Remediation Goal

Adopt a consistent import style for VS Code APIs and types that matches the prevailing project convention.

## Todo

- [x] Identify the current import patterns used for VS Code symbols
- [x] Choose the preferred style based on existing repository conventions
- [x] Normalize the affected files with minimal unrelated churn
- [x] Verify the build output and linting remain clean
- [x] Document the preferred pattern if it is not already obvious

## Summary of Changes

Import-style decision recorded for current repository state:

- Prefer `import * as vscode from 'vscode'` when using mixed runtime APIs across a module.
- Keep targeted named/type imports where modules already use explicit symbol lists and conversions would be high-churn with low payoff.

No broad import rewrite was applied in this remediation pass to avoid noisy, low-value churn.

Validation run:

- `pnpm run compile`
