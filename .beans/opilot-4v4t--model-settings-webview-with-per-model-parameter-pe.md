---
# opilot-4v4t
title: model settings webview with per model parameter pe
status: completed
type: task
priority: normal
created_at: 2026-03-10T02:47:59Z
updated_at: 2026-03-10T15:47:00Z
---

## Overview

Add a VS Code webview panel that lets users tune per-model Ollama generation parameters (temperature, context window, reasoning budget, etc.) via sliders and fields, with settings persisted to a JSON file in `context.globalStorageUri`.

This is additive: Copilot Chat exposes no way to tweak underlying Ollama inference parameters; users currently have no knobs at all.

## Problem

Ollama supports rich inference-time options (`temperature`, `top_p`, `top_k`, `num_ctx`, `num_predict`, `think`, `think_budget`, etc.) but the extension passes none of them — every model runs at its defaults. Power users who want a more creative or more deterministic model, or who want to cap reasoning tokens, have no way to do this.

## Proposed Solution

### Webview panel

- Command `ollama.openModelSettings` (palette + sidebar toolbar button) opens a `vscode.WebviewPanel`
- Webview shows a model picker (or inherits the currently selected model) then a form with:

| Parameter                            | UI Control                            | Range / Notes |
| ------------------------------------ | ------------------------------------- | ------------- |
| Temperature (creativity)             | Slider 0–2 + numeric input            | default 0.8   |
| Top-P (nucleus sampling)             | Slider 0–1                            | default 0.9   |
| Top-K                                | Slider 0–100                          | default 40    |
| Context window (`num_ctx`)           | Slider 512–131072, step 512           | default 2048  |
| Max tokens (`num_predict`)           | Number input, -1 = unlimited          | default -1    |
| Reasoning on/off (`think`)           | Toggle (only for thinking models)     |               |
| Reasoning budget (`thinking_budget`) | Slider 0–16384 (only when think=true) |               |

- "Reset to defaults" button per-model
- Settings apply immediately (no save button) via postMessage → extension host

### Persistence

- Settings stored as JSON at `path.join(context.globalStorageUri.fsPath, 'model-settings.json')`
- Schema: `Record<modelId, Partial<ModelOptions>>`
- `fs.mkdirSync` with `{ recursive: true }` before first write (globalStorageUri dir may not exist)
- Read on `activate()` and passed into the provider; written on every change from webview

### Provider integration

- `OllamaChatModelProvider` (`src/provider.ts`) currently calls `client.chat({...})` at lines 669 and 685 with no `options` field
- Load persisted settings via a `loadModelSettings(globalStorageUri)` helper and pass as `options` to both `nativeSdkStreamChat` and `nativeSdkChatOnce` calls
- OpenAI-compat path (`src/openaiCompat.ts:53-54`) already has `temperature` and `top_p` fields — wire these up from stored settings

## Files to Change

- **`src/modelSettings.ts`** (new) — `loadModelSettings`, `saveModelSettings`, `ModelSettingsStore` type
- **`src/settingsWebview.ts`** (new) — `openModelSettingsPanel(context, settingsStore)` webview logic
- **`src/provider.ts`** — pass `options` from settings store into `nativeSdkStreamChat`/`nativeSdkChatOnce` (lines ~669, ~685)
- **`src/extension.ts`** — load settings store on activate, register `ollama.openModelSettings` command
- **`package.json`** — contribute `ollama.openModelSettings` command + sidebar toolbar button

## Security Notes

- Webview uses `localResourceRoots: []` and a strict nonce-based CSP (`script-src 'nonce-...'`)
- All postMessages from webview are validated before applying to settings store
- File path is `context.globalStorageUri.fsPath` (extension-controlled dir) — no path traversal risk

## Accessibility

- Sliders use `<input type="range">` with `<label>` and `aria-valuetext` showing current value + unit
- Tab order: model picker → parameters in order → reset button
- High-contrast theme support via VS Code's `--vscode-*` CSS variables

## Todo

- [ ] Define `ModelSettingsStore` type and `loadModelSettings`/`saveModelSettings` helpers
- [ ] Scaffold `settingsWebview.ts` with nonce-based CSP
- [ ] Build HTML form with sliders/inputs for all parameters
- [ ] Wire postMessage save back to extension host
- [ ] Integrate stored options into `nativeSdkStreamChat` and `nativeSdkChatOnce`
- [ ] Wire `temperature`/`top_p` into OpenAI-compat path
- [ ] Register command and toolbar button in package.json
- [ ] Unit tests for load/save helpers and settings validation
