---
# opilot-zgmx
title: 023 Add dedicated tests for built-in Ollama conflict handling
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-ah8d
id: opilot-zgmx
---

Source issue 023 from `docs/plans/remediation-plan.md`.

## Summary

`handleBuiltInOllamaConflict` currently lacks targeted tests for a user-visible and stateful workflow.

## Files

- `src/extension.ts`
- related test files under `src/*.test.ts`

## Remediation Goal

Capture the conflict-resolution behavior in direct tests so future refactors do not regress user-facing prompts or state transitions.

## Todo

- [ ] Review the conflict-handling flow and identify major branches to cover
- [ ] Add focused tests for accept, dismiss, and non-conflict scenarios as appropriate
- [ ] Mock VS Code interactions only at the necessary boundaries
- [ ] Verify the tests stay resilient to unrelated UI wording changes where possible
- [ ] Confirm the coverage protects future cleanup or refactor work in this area
