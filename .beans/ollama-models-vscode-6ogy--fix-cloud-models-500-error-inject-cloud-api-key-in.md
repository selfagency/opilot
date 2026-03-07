---
# ollama-models-vscode-6ogy
title: Fix cloud models 500 error — inject cloud API key in Ollama client
status: completed
type: bug
priority: high
created_at: 2026-03-07T17:17:38Z
updated_at: 2026-03-07T17:35:19Z
---

Cloud model chat requests return a 500 error because the Ollama local server requires `Authorization: Bearer <cloudApiKey>` to proxy requests to Ollama's cloud backend. The extension never includes the cloud API key in chat/generate/pull client requests.

## Root Cause

The extension uses the standard `getOllamaClient(context)` for all calls. Cloud model requests must use a client that sends the cloud API key (stored as `ollama-cloud-api-key` in secrets) as the Bearer token.

## Todo

- [x] Add `getCloudOllamaClient(context: vscode.ExtensionContext): Promise<Ollama>` export to `src/client.ts` — reads `ollama-cloud-api-key` secret, sets `Authorization: Bearer <key>` header on the Ollama client
- [x] In `src/sidebar.ts` `LocalModelsProvider.startModel()`: when `isCloudTaggedModel(modelName)`, use `getCloudOllamaClient` for the pull and generate warmup calls
- [x] In `src/provider.ts` `provideLanguageModelChatResponse()`: check if `runtimeModelId` has a cloud tag (`:cloud` suffix or matches `isCloudTaggedModel`); if so, use `getCloudOllamaClient(this.context)` as `perRequestClient`
- [x] Run `pnpm run compile` to verify TypeScript passes
- [x] Run `pnpm run test` to verify unit tests still pass

## Summary of Changes

- `src/client.ts`: Added `getCloudOllamaClient(context)` — creates an Ollama client with `Authorization: Bearer <ollama-cloud-api-key>` header.
- `src/sidebar.ts`: `LocalModelsProvider` gains an optional `context: ExtensionContext` constructor param. `startModel()` uses the cloud client when warming a cloud-tagged model.
- `src/provider.ts`: `provideLanguageModelChatResponse()` detects cloud-tagged `runtimeModelId` and uses `getCloudOllamaClient` as the per-request client.
- `src/sidebar.test.ts`: Updated one `LocalModelsProvider` call site to reflect the shifted constructor arity.
