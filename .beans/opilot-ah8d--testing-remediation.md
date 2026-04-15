---
# opilot-ah8d
title: Testing remediation
status: completed
type: epic
priority: normal
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-15T01:02:00Z
parent: opilot-fu6s
---

Backfill targeted tests for review findings that currently lack direct coverage.

## Included Findings

- 022 No dedicated test for `removeBuiltInOllamaFromChatLanguageModels`
- 023 No dedicated test for `handleBuiltInOllamaConflict`

## Todo

- [x] Review current coverage around the identified behaviors
- [x] Create child issues for each testing gap
- [x] Capture preferred test level and fixtures per item
- [x] Verify the epic covers all testing findings from the plan

## Summary of Changes

Completed child findings:

- `opilot-f7f1` (022): verified dedicated coverage for built-in provider removal paths in `src/extension.test.ts`.
- `opilot-zgmx` (023): verified dedicated coverage for built-in provider conflict-handling branches in `src/extension.test.ts`.

Validation used targeted extension tests and compile checks per issue commit.
