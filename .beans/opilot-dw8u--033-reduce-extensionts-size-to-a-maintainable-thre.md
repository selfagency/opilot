---
# opilot-dw8u
title: 033 Reduce extension.ts size to a maintainable threshold
status: completed
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-15T13:36:19Z
parent: opilot-g952
---

Source issue 033 from `docs/plans/remediation-plan.md`.

## Summary

`src/extension.ts` exceeds a maintainable threshold from a code-quality perspective, overlapping partly with the broader architecture finding.

## Files

- `src/extension.ts`
- any extracted modules introduced during the cleanup

## Remediation Goal

Shrink the file enough to improve readability and navigability while avoiding refactors that provide churn without value.

## Todo

- [x] Review the overlap with issue 003 and decide whether one implementation can satisfy both findings
- [x] Identify the lowest-risk extractions or reorganizations that materially improve maintainability
- [x] Execute the cleanup in small, behavior-preserving steps
- [x] Add or update characterization tests around moved logic
- [x] Confirm the final structure is easier to navigate and review

## Summary of Changes

Resolved via overlap with prior architecture cleanup (issue 003) and already-landed extraction work:

- Shared activation/configuration helpers now live in `src/extensionHelpers.ts` (136 lines), reducing `extension.ts` responsibilities.
- Follow-up slices in this remediation pass continued extracting concerns from `extension.ts` (timeouts policy docs, type-safe tool-loop handling) without destabilizing request flow behavior.

Current line count snapshot:

- `src/extension.ts`: 1270 lines
- `src/extensionHelpers.ts`: 136 lines

Given overlap scope and risk profile, no additional broad extraction was applied in this issue slice.

Validation run:

- `pnpm run compile`
