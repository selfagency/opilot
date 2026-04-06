---
# ollama-models-vscode-pcqe
title: fix per model num ctx sidebar settings being overr
status: completed
type: task
priority: normal
created_at: 2026-04-06T15:01:09Z
updated_at: 2026-04-06T15:02:16Z
---

## Summary of Changes

- `contextUtils.ts`: flipped `resolveContextLimit` priority — `num_ctx` sidebar override now beats model-reported `maxInputTokens`
- `contextUtils.test.ts`: updated tests for new priority
- `provider.ts`: `OllamaChatModelProvider` now accepts a `getModelSettings` getter and wires per-model options through all truncation and API call paths
- `extension.ts`: passes live `modelSettingsStore` getter to provider

Branch: `fix/ollama-models-vscode-pcqe-per-model-num-ctx-overridden`  
PR: https://github.com/selfagency/opilot/pull/85
