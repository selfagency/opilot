---
# opilot-93t0
title: 037 Add disambiguation examples for participant auto routing
status: completed
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-15T07:28:00Z
parent: opilot-itbr
---

Source issue 037 from `docs/plans/remediation-plan.md`.

## Summary

The chat participant lacks disambiguation examples, limiting automatic routing quality.

## Files

- `package.json`

## Remediation Goal

Provide examples that help VS Code understand which prompts belong with the participant while minimizing false positives.

## Todo

- [x] Review overlap with issue 026 and decide whether one change will satisfy both findings
- [x] Draft representative examples based on actual participant capabilities
- [x] Add the examples to the participant contribution metadata
- [x] Validate the examples for clarity and routing specificity
- [x] Confirm the change closes the documented gap without overfitting to narrow cases

## Summary of Changes

Resolved via overlap with `opilot-yb63` (026):

- `package.json` chat participant contribution includes `disambiguation.examples` for routing quality.
- Examples are specific to Ollama-local/cloud usage and troubleshooting prompts.

Validation run:

- `pnpm run compile`
