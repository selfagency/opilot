---
# opilot-dw8u
title: 033 Reduce extension.ts size to a maintainable threshold
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-14T21:40:17Z
parent: opilot-g952
id: opilot-dw8u
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

- [ ] Review the overlap with issue 003 and decide whether one implementation can satisfy both findings
- [ ] Identify the lowest-risk extractions or reorganizations that materially improve maintainability
- [ ] Execute the cleanup in small, behavior-preserving steps
- [ ] Add or update characterization tests around moved logic
- [ ] Confirm the final structure is easier to navigate and review
