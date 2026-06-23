# Comprehensive Remediation Plan

## Overview

Combined analysis of Ollama API docs, VS Code AI Extensibility API docs, and the Opilot codebase.
Covers **5 fixes**, **7 enhancements**, and **1 migration opportunity**.

---

## 🔴 Phase 1: Bug Fixes (Priority Order)

### F1 — `think` parameter: boolean-only → GPT-OSS incompatible

**Files**: `src/provider.ts`, `src/chat-utils.ts`, `src/model-settings.ts`
**Issue**: `shouldThink` is `boolean`. The Ollama API accepts `true`/`false` OR `"low"`/`"medium"`/`"high"` (GPT-OSS). Passing `true` for GPT-OSS silently disables thinking.
**Fix**: Change `shouldThink` to `think` with type `boolean | 'low' | 'medium' | 'high'`. Add a `thinkingEffort` model setting. Forward the value to both native SDK calls and OpenAI-compat requests.
**Tests needed**: Verify GPT-OSS model gets correct think value.

### F2 — Missing `gpt-oss` in thinking model pattern

**File**: `src/provider.ts` (line 1573)
**Issue**: `gpt-oss` not in `THINKING_MODEL_PATTERN`.
**Fix**: Add `gpt-oss` to regex.
**Tests needed**: Verify `isThinkingModelId('gpt-oss')` returns true.

### F3 — Streaming error detection missing for native SDK path

**File**: `src/provider.ts` (lines 766-852)
**Issue**: Mid-stream NDJSON errors (`{"error":"..."}`) handled in OpenAI-compat path via `assertNoMidStreamError`, but the native SDK loop doesn't check `chunk.error`.
**Fix**: Add `if (chunk.error)` check in the `for await` loop. Log and skip/abort on error chunks.
**Tests needed**: Simulate error chunk in stream test.

### F4 — `silent` parameter ignored in model information

**File**: `src/provider.ts` (line 106)
**Issue**: `_options: { silent: boolean }` is prefixed `_` (unused). The `silent` flag should suppress credential prompts during background discovery.
**Fix**: Thread `silent` through `refreshModelList`/`getChatModelInfo`. Skip auth prompts when silent.
**Tests needed**: Test with `{ silent: true }` returns empty list without side effects.

### F5 — OpenAI-compat `reasoning_effort` not forwarded

**File**: `src/chat-utils.ts` (lines 100-112)
**Issue**: `buildOpenAiCompatRequest` doesn't pass `reasoning_effort` for cloud models.
**Fix**: When `shouldThink` is a string value, forward as `reasoning_effort` in the OpenAI-compat request. When boolean `true`, omit (Ollama defaults apply).
**Tests needed**: Test buildOpenAiCompatRequest with string think value.

---

## 🟡 Phase 2: Enhancements

### E1 — Structured outputs (`format` parameter)

**File**: `src/provider.ts`, `src/chat-utils.ts`
**Description**: Expose the `format` parameter (for JSON schema responses) through a model setting or request option.
**Implementation**:

1. Add `structuredOutput` model setting (boolean, default false).
2. When enabled, pass `format: 'json'` in both native SDK and OpenAI-compat requests.
3. Optionally allow specifying a JSON schema via model settings.
**VS Code API alignment**: The `LanguageModelChatProvider` API does not have a built-in `format` option — this would be provider-specific.

### E2 — Forward OpenAI-compat extended parameters

**File**: `src/chat-utils.ts`
**Description**: Add `seed`, `stop`, `frequency_penalty`, `presence_penalty` to `buildOpenAiCompatRequest`. These are supported by Ollama's OpenAI-compat endpoint but not forwarded.
**Implementation**: Extract from `params.modelOptions` and include when defined.
**Tests needed**: Verify params are included in the request body.

### E3 — Web search / web fetch as provider tools

**Files**: `src/provider.ts`, `src/extension.ts`, `package.json`
**Description**: Register `ollama_webSearch` and `ollama_webFetch` as language model tools via `vscode.lm.registerTool()`. The Ollama SDK v0.6.3 has `client.webSearch()` and `client.webFetch()` methods (runtime only — TypeScript types missing).
**Implementation**:

1. Define tool schemas in `package.json` `contributes.languageModelTools`.
2. Implement `LanguageModelTool` class with `invoke()` calling the Ollama SDK methods.
3. Gate behind `opilot.experimental.webSearch` setting.
**Note**: Web search requires `OLLAMA_API_KEY` auth. Opilot already has `getOllamaAuthHeaders()` for bearer token support.

### E4 — Language model tool registration for agent mode (Copilot-aligned pattern)

**File**: `package.json`, `src/extension.ts`
**Description**: Register Opilot capabilities as VS Code language model tools via `contributes.languageModelTools` in `package.json` + `vscode.lm.registerTool()`. This is the **same pattern the official Copilot extension uses** (see `extensions/copilot/package.json` which registers `copilot_searchCodebase`, `copilot_findFiles`, `copilot_readFile`, etc.).
**What to register**:

1. `ollama_webSearch` — call `client.webSearch()` (Ollama SDK v0.6.3)
2. `ollama_webFetch` — call `client.webFetch()`
3. `ollama_createEmbedding` — call `client.embed()` for RAG workflows

**Notes**:

- `@vscode/chat-extension-utils` is **ARCHIVED** (Apr 2026) — deprecated, do NOT use.
- The Copilot extension uses `contributes.languageModelTools` + `vscode.lm.registerTool()`. Opilot should follow the same pattern for LM tool registration.
- Web search requires `OLLAMA_API_KEY` — piggyback on existing `getOllamaAuthHeaders()`.

### E5 — `@vscode/chat-lib` investigation

**File**: Investigation only
**Description**: `@vscode/chat-lib` is the internal SDK extracted from VS Code Copilot Chat. It uses `@vscode/prompt-tsx`, `@vscode/copilot-api`, `openai`, and tree-sitter. This is the SDK Microsoft uses internally for building Copilot Chat.
**Recommendation**: Monitor for public release. Not currently consumed by third-party extensions. Do NOT adopt yet — it's an internal SDK with no public documentation or support.

### E6 — Logprobs support

**Files**: `src/provider.ts`, `src/chat-utils.ts`
**Description**: Forward `logprobs: true` and `top_logprobs: N` from model options to the API. Return logprobs data in the response.
**Priority**: Low — debug/educational use.

### E7 — `keep_alive` in normal requests

**File**: `src/chat-utils.ts`
**Description**: Add `keep_alive` parameter support to `nativeSdkStreamChat`, `nativeSdkChatOnce`, and `buildOpenAiCompatRequest`. Currently only used in crash recovery (set to `0`).
**Implementation**: Add `keepAlive` option to model settings. Default = undefined (Ollama default behavior).

---

## 🟢 Phase 3: Coverage On-Ramp

### C1 — Test coverage for new functionality

Add dedicated test coverage for each added path:

- `chat-utils.test.ts` — confirm all branches are hit
- `provider.test.ts` — add tests for `silent` mode, `think` string values, error chunks

---

## 📋 Detailed IOC (Implementation Order)

| Step | Work Item | Est. Effort | Dependencies |
|------|-----------|-------------|--------------|
| 1 | F2 — Add `gpt-oss` to thinking regex | 5 min | None |
| 2 | F1 — String `think` value support | 1h | F2 |
| 3 | F5 — `reasoning_effort` in OpenAI-compat | 30 min | F1 |
| 4 | F4 — Handle `silent` parameter | 30 min | None |
| 5 | F3 — Native stream error chunk detection | 30 min | None |
| 6 | E2 — Extended OpenAI-compat params | 30 min | None |
| 7 | E1 — Structured outputs | 1h | None |
| 8 | E7 — `keep_alive` in model settings | 30 min | None |
| 9 | E3 — Web search/fetch tools | 2h | E3 investigation |
| 10 | E5 — Language model tool registration | 1h | None |
| 11 | E4 — Evaluate `@vscode/chat-extension-utils` | 1h | Research |
| 12 | C1 — Test coverage | 2h | F1-F5, E1-E2 |

**Total estimated effort**: ~10.5 hours across 12 work items.

---

## ✅ Already Correct (No Action Needed)

| Feature | Evidence |
|---------|----------|
| Vision | `toOllamaMessages()` converts images to `images[]` field correctly |
| Tool calling | `mapOpenAiToolCallsToOllamaLike()` handles streaming + non-streaming |
| Context length | `num_ctx` forwarded in both SDK and OpenAI-compat paths |
| Keep-alive (crash recovery) | `keep_alive: 0` used in crash unload |
| Chat participant | `@ollama` participant registered with handler and follow-ups |
| Provider registration | `lm.registerLanguageModelChatProvider` with vendor `selfagency-opilot` |
| Auth token management | `setAuthToken()` via `context.secrets` + `managementCommand` equivalent |
| Model discovery | `provideLanguageModelChatInformation` with `prefetchModels()` |
| Modelfile support | Dedicated sidebar + commands |
| `hideThinkingContent` setting | Correctly suppresses thinking blockquote |

---

## 🎯 Updated Priority Ranking

| Priority | Item | Est. Time | Rationale |
|----------|------|-----------|-----------|
| **P0** | F2 — Add `gpt-oss` to thinking regex | 5 min | Trivial, blocks GPT-OSS thinking |
| **P0** | F1 — String `think` value support | 1h | Fixes GPT-OSS incompatibility |
| **P1** | F4 — Handle `silent` parameter | 30 min | Correct provider behavior |
| **P1** | F3 — Native stream error detection | 30 min | Defensive correctness |
| **P1** | F5 — `reasoning_effort` forwarding | 30 min | Cloud model parity |
| **P2** | E2 — Extended OpenAI-compat params | 30 min | Cloud model completeness |
| **P2** | E4 — LM tool registration (Copilot pattern) | 2h | Platform integration, unlocks agent mode |
| **P3** | E1 — Structured outputs | 1h | Feature request |
| **P3** | E3 — Web search/fetch as tools | 1.5h | Differentiator, piggybacks on E4 |
| **P3** | E7 — `keep_alive` support | 30 min | Power user setting |
| **P3** | E5 — `@vscode/chat-lib` investigation | Research | Monitor; not yet public |
| **P3** | C1 — Test coverage | 2h | CI quality gate |

**Deprecated**: `@vscode/chat-extension-utils` — archived Apr 2026, alpha-only, never reached stable release. **Do not use.**
