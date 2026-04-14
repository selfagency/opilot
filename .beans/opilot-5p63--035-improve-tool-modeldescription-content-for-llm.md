---
# opilot-5p63
title: 035 Improve tool modelDescription content for LLM use
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-14T21:40:17Z
parent: opilot-itbr
id: opilot-5p63
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

- [ ] Review current tool descriptions for missing usage guidance and limitations
- [ ] Rewrite descriptions to explain purpose, constraints, and non-goals more clearly
- [ ] Keep wording concise enough to remain maintainable
- [ ] Validate the descriptions across all contributed tools for consistency
- [ ] Confirm the updated metadata still fits repository style and manifest expectations
