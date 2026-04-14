---
# opilot-okwg
title: 007 Replace embedded PowerShell string scripts with safer command construction
status: todo
type: task
priority: low
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-yva4
id: opilot-okwg
---

Source issue 007 from `docs/plans/remediation-plan.md`.

## Summary

A PowerShell script is embedded as a string literal. It is currently considered safe, but it is harder to reason about and maintain than structured command construction.

## Files

- `src/extension.ts`

## Remediation Goal

Reduce script-string risk by using structured arguments or a safer abstraction for PowerShell invocation.

## Todo

- [ ] Locate the PowerShell invocation and document its current behavior
- [ ] Replace the inline script with structured arguments or a safer wrapper where possible
- [ ] Preserve quoting and escaping behavior across supported Windows environments
- [ ] Add validation coverage for the resulting command shape
- [ ] Verify the user-facing workflow remains unchanged
