---
# ollama-models-vscode-acrx
title: Fix cloud model stop using base name instead of resolved tag
status: todo
type: bug
priority: high
created_at: 2026-03-07T17:17:28Z
updated_at: 2026-03-07T17:19:38Z
---

When stopping a cloud model, Ollama returns "model '{name}' not found" because the stop command uses the base model name (e.g. `kimi-k2-thinking`) instead of the pulled tag name (`kimi-k2-thinking:cloud`).

## Root Cause

`handleStopCloudModel` calls `localProvider.stopModel(item.label)` where `item.label` is the base name. The actually pulled/warmed model is `baseName:cloud`.

## Todo

- [ ] Add `warmedModelResolvedNames: Map<string, string>` private field to `CloudModelsProvider` in `src/sidebar.ts`
- [ ] Update `markModelWarm(modelName: string, resolvedName?: string)` signature and body to store the resolved name in the map
- [ ] Add `getWarmedModelName(baseName: string): string` method that returns the stored resolved name or falls back to `baseName:cloud`
- [ ] Update `handleStartCloudModel` to call `cloudProvider.markModelWarm(item.label, resolvedModel)` passing both args
- [ ] Update `handleStopCloudModel` to use `cloudProvider.getWarmedModelName(item.label)` for the stop call
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
