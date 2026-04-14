---
# opilot-f7f1
title: 022 Add dedicated tests for removing built-in Ollama models
status: todo
type: task
priority: low
created_at: 2026-04-14T21:39:09Z
updated_at: 2026-04-14T21:39:09Z
parent: opilot-ah8d
id: opilot-f7f1
---

Source issue 022 from `docs/plans/remediation-plan.md`.

## Summary

`removeBuiltInOllamaFromChatLanguageModels` lacks direct tests even though it mutates configuration files in a sensitive way.

## Files

- `src/extension.ts`
- related test files under `src/*.test.ts`

## Remediation Goal

Add focused coverage that proves the removal logic edits only the intended entries and handles edge cases safely.

## Todo

- [ ] Review the current behavior and identify scenarios that deserve direct coverage
- [ ] Add focused unit tests for empty, matching, and unrelated configuration content
- [ ] Include at least one case that exercises failure or retry behavior if implemented
- [ ] Verify the tests are isolated and do not depend on real user configuration
- [ ] Confirm the tests would catch accidental over-removal or formatting regressions
