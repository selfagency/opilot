---
# opilot-5cdc
title: 034 Align tool names with the recommended verb noun pattern
status: todo
type: task
priority: low
created_at: 2026-04-14T21:40:17Z
updated_at: 2026-04-14T21:40:17Z
parent: opilot-itbr
id: opilot-5cdc
---

Source issue 034 from `docs/plans/remediation-plan.md`.

## Summary

Some tool names do not follow the recommended `{verb}_{noun}` pattern from the VS Code AI tools guidance.

## Files

- `package.json`
- `src/toolUtils.ts`
- any related tool registration helpers

## Remediation Goal

Rename or normalize tool identifiers where beneficial so models can select them more accurately.

## Todo

- [ ] Inventory current tool names and compare them against the recommended naming convention
- [ ] Identify which names materially benefit from normalization and which should remain stable for compatibility
- [ ] Update the chosen tool identifiers and related references consistently
- [ ] Validate manifest and runtime behavior after renaming
- [ ] Document any compatibility considerations or migration notes
