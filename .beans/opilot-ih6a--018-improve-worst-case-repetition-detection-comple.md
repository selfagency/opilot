---
# opilot-ih6a
title: 018 Improve worst-case repetition detection complexity
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-wn59
id: opilot-ih6a
---

Source issue 018 from `docs/plans/remediation-plan.md`.

## Summary

Repetition detection in `src/contextUtils.ts` can degrade to O(n^2) behavior in the worst case.

## Files

- `src/contextUtils.ts`

## Remediation Goal

Use a more efficient approach for repetition detection while preserving current output quality.

## Todo

- [ ] Profile or reason through the current repetition-detection logic and hot cases
- [ ] Choose a clearer or more efficient algorithmic approach
- [ ] Refactor the implementation with benchmarks or representative tests where sensible
- [ ] Add regression coverage for edge cases and large inputs
- [ ] Verify the output quality remains acceptable after the optimization
