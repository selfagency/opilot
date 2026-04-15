---
# opilot-okwg
title: 007 Replace embedded PowerShell string scripts with safer command construction
status: completed
type: task
priority: low
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-15T00:15:00Z
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

- [x] Locate the PowerShell invocation and document its current behavior
- [x] Replace the inline script with structured arguments or a safer wrapper where possible
- [x] Preserve quoting and escaping behavior across supported Windows environments
- [x] Add validation coverage for the resulting command shape
- [x] Verify the user-facing workflow remains unchanged

## Summary of Changes

Replaced ad-hoc inline PowerShell log-tail script usage in `src/extension.ts` with a structured command builder:

- Added `getWindowsLogTailPowerShellArgs()` that returns explicit PowerShell argument arrays.
- Escapes single quotes in resolved log path for safer script composition.
- `startLogStreaming` now calls the builder and passes only structured args to `spawn('powershell', args)`.

Added validation coverage in `src/extension.utils.test.ts` for command shape and quote escaping behavior.

Validation run:

- `pnpm vitest run src/extension.utils.test.ts src/extension.test.ts`
- `pnpm run compile`
