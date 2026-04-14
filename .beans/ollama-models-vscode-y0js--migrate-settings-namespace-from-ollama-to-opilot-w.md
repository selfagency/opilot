---
# ollama-models-vscode-y0js
title: Migrate settings namespace from ollama.* to opilot.* with compatibility fallback
status: completed
type: feature
priority: high
created_at: 2026-03-16T22:24:14Z
updated_at: 2026-04-14T21:30:57Z
---

## Context

Opilot branding uses `opilot`, but configuration keys are currently under `ollama.*`.

## Goal

Introduce `opilot.*` settings while preserving backward compatibility with existing `ollama.*` users.

## Todo

- [x] Audit all settings reads/writes and manifest contributions
- [x] Add `opilot.*` settings and deprecate `ollama.*` keys
- [x] Implement runtime fallback + migration from `ollama.*` to `opilot.*`
- [x] Update docs/tests to reflect new namespace and compatibility behavior
- [x] Run tests and validate migration behavior

## Tracking

- Branch: `feat/y0js-opilot-settings-namespace`

## Summary of Changes

- Added new `opilot.*` settings in extension contributions.
- Marked legacy `ollama.*` settings as deprecated in the manifest.
- Implemented runtime namespace compatibility (`opilot` first, `ollama` fallback) via `src/settings.ts`.
- Added activation-time auto-migration of legacy settings to `opilot.*`.
- Updated docs/examples to prefer `opilot.*` keys while preserving compatibility.
- Updated tests for contributions and settings-open behavior.

## Tracking Update

- PR: https://github.com/selfagency/opilot/pull/73
