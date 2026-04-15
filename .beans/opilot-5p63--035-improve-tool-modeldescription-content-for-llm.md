---
# opilot-5p63
title: 035 Improve tool modelDescription content for LLM use
status: completed
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-15T07:34:00Z
parent: opilot-itbr
---

Source issue 035 from `docs/plans/remediation-plan.md`.

## Summary

Some tool descriptions could better explain when a tool should and should not be used, which can improve model routing quality.

## Files

- `package.json`
- `src/toolUtils.ts`

## Remediation Goal

Make tool descriptions more operationally useful to the model without bloating them into unreadable manifest sludge.

## Todo

- [x] Review current tool descriptions for missing usage guidance and limitations
- [x] Rewrite descriptions to explain purpose, constraints, and non-goals more clearly
- [x] Keep wording concise enough to remain maintainable
- [x] Validate the descriptions across all contributed tools for consistency
- [x] Confirm the updated metadata still fits repository style and manifest expectations

## Summary of Changes

Audit outcome:

- Current manifest does not contribute `languageModelTools` or `modelDescription` metadata for tool contributions in this repository state.
- `src/toolUtils.ts` provides helper utilities and does not define manifest tool descriptions.

Result:

- No metadata rewrite was applied to avoid introducing synthetic tool metadata not currently used by this extension.

Validation run:

- `pnpm run compile`
