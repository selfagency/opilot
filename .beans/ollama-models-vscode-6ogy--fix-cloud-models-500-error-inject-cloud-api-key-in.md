---
# ollama-models-vscode-6ogy
title: Fix cloud models 500 error — inject cloud API key in Ollama client
status: todo
type: bug
priority: high
created_at: 2026-03-07T17:17:38Z
updated_at: 2026-03-07T17:19:41Z
---

Cloud model chat requests return a 500 error because the Ollama local server requires `Authorization: Bearer <cloudApiKey>` to proxy requests to Ollama's cloud backend. The extension never includes the cloud API key in chat/generate/pull client requests.

## Root Cause

The extension uses the standard `getOllamaClient(context)` for all calls. Cloud model requests must use a client that sends the cloud API key (stored as `ollama-cloud-api-key` in secrets) as the Bearer token.

## Todo

- [ ] Add `getCloudOllamaClient(context: vscode.ExtensionContext): Promise<Ollama>` export to `src/client.ts` — reads `ollama-cloud-api-key` secret, sets `Authorization: Bearer <key>` header on the Ollama client
- [ ] In `src/sidebar.ts` `LocalModelsProvider.startModel()`: when `isCloudTaggedModel(modelName)`, use `getCloudOllamaClient` for the pull and generate warmup calls
- [ ] In `src/provider.ts` `provideLanguageModelChatResponse()`: check if `runtimeModelId` has a cloud tag (`:cloud` suffix or matches `isCloudTaggedModel`); if so, use `getCloudOllamaClient(this.context)` as `perRequestClient`
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
