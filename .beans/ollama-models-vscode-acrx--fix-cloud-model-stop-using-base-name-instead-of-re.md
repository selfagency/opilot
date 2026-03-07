---
# ollama-models-vscode-acrx
title: Fix cloud model stop using base name instead of resolved tag
status: completed
type: bug
priority: high
created_at: 2026-03-07T17:17:28Z
updated_at: 2026-03-07T17:35:04Z
---

When stopping a cloud model, Ollama returns "model '{name}' not found" because the stop command uses the base model name (e.g. `kimi-k2-thinking`) instead of the pulled tag name (`kimi-k2-thinking:cloud`).

## Root Cause

`handleStopCloudModel` calls `localProvider.stopModel(item.label)` where `item.label` is the base name. The actually pulled/warmed model is `baseName:cloud`.

## Todo

- [x] Add `warmedModelResolvedNames: Map<string, string>` private field to `CloudModelsProvider` in `src/sidebar.ts`
- [x] Update `markModelWarm(modelName: string, resolvedName?: string)` signature and body to store the resolved name in the map
- [x] Add `getWarmedModelName(baseName: string): string` method that returns the stored resolved name or falls back to `baseName:cloud`
- [x] Update `handleStartCloudModel` to call `cloudProvider.markModelWarm(item.label, resolvedModel)` passing both args
- [x] Update `handleStopCloudModel` to use `cloudProvider.getWarmedModelName(item.label)` for the stop call
- [x] Run `pnpm run compile` to verify TypeScript passes
- [x] Run `pnpm run test` to verify unit tests still pass

## Summary of Changes

Added `warmedModelResolvedNames` map and `getWarmedModelName()` method to `CloudModelsProvider`. Updated `markModelWarm` to accept and store the resolved name. Updated `handleStartCloudModel` to pass `resolvedModel` and `handleStopCloudModel` to use `getWarmedModelName()`. Updated tests accordingly. Commit: `93bbac2`.
