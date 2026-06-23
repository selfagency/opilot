# Task Context: Comprehensive Issue Remediation

Session ID: 2026-06-22-issue-remediation-plan
Created: 2026-06-22T18:00:00Z
Status: in_progress

## Current Request

Review all GitHub issues for this repository and develop a full remediation plan. User approved plan development.

## Context Files (Standards to Follow)

- .opencode/context/project-intelligence/technical-domain.md
- AGENTS.md

## Reference Files (Source Material)

- src/provider.ts — Chat provider (all 5 issues touch this)
- src/extension.ts — Extension activation
- src/extension-helpers.ts — Connection test failure handler
- src/formatting.ts — appendToBlockquote, text formatting
- src/chat-utils.ts — Streaming/non-stream chat helpers
- src/compression.ts — Context compression
- src/thinking-parser.ts — Custom thinking parser (if exists)
- node_modules/@agentsy/core/processor.js — LLMStreamProcessor
- node_modules/@agentsy/core/thinking.js — ThinkingParser
- node_modules/@agentsy/providers/normalizers.js — normalizeOllamaChatChunk

## Components (Remediation Units)

### Issue #127 — Short Response Thinking Block Rendering

**Type**: Bug fix
**Component**: src/provider.ts (lines 749-860)
**Problem**: Very short model responses render inside the thinking blockquote in VS Code Chat UI.
**Analysis**: The rendering logic for the thinking/response boundary is entirely in Opilot. When `chunk.message.thinking` fires (line 774), the blockquote header + content are emitted. When `chunk.message.content` subsequently fires (line 791), a `\n\n` separator is added. For very short responses (1-2 words on a single line), this separator can fail to visually break the blockquote in VS Code's markdown renderer.
**Root cause**: The `\n\n` markdown separator between blockquote thinking content and response content is insufficient in certain edge cases, particularly when:

1. Response is so short the model emits both `thinking` and `content` in a single chunk
2. `thinkingLineStart` tracking creates off-by-one formatting issues
3. The `flush()` output (line 855) lacks a `\n\n` separator
**Fix**: Add robust non-breaking separator (e.g., `<br>`) or ensure the blockquote is properly terminated with a clear visual boundary. Also ensure `flush()` output includes separator.

### Issue #126 — Context Usage Indicator (provideTokenCount)

**Type**: Bug fix
**Component**: src/provider.ts (lines 1477-1509)
**Problem**: `provideTokenCount` uses chars/4 heuristic instead of Ollama's `/api/tokenize` endpoint.
**Analysis**: The method signature takes `_model`, `text`, and `_token` but the model parameter is unused and the count is always `Math.ceil(textContent.length / 4)`. Ollama exposes `/api/tokenize` and the npm SDK has `.tokenize()`.
**Fix**: Implement real tokenization using `client.tokenize({ model, prompt })` with caching and fallback to heuristic. The issue author provided a reference implementation.

### Issue #125 — Native Expandable Reasoning (LanguageModelThinkingPart)

**Type**: Feature
**Component**: src/provider.ts (provideLanguageModelChatResponse)
**Problem**: Thinking renders as an inline blockquote, not VS Code's native collapsible thinking widget.
**Analysis**: VS Code has a proposed API `LanguageModelThinkingPart` that renders an expandable "Thinking" block. The provider should emit `LanguageModelThinkingPart` for thinking tokens and `LanguageModelTextPart` for response content. This is an enhancement, not a bug fix.
**Fix**: When thinking content is streamed, emit `LanguageModelThinkingPart` instead of manual blockquote formatting. This is an **experimental** VS Code API behind `vscode.proposed.languageModelThinkingPart`.

### Issue #124 — Phantom User Message (ensurePromptMessage)

**Type**: Bug fix
**Component**: src/provider.ts (lines 1330-1438)
**Problem**: `ensurePromptMessage` fabricates a user turn by scraping `options` for any string that looks "prompt-like", and the heuristic accepts extension IDs like `github.copilot-chat`.
**Analysis**:

- `ensurePromptMessage` → when no meaningful user text, calls `extractPromptFromOptions`
- `extractPromptFromOptions` → recursively walks `options.modelOptions` then `options` for any string
- `deepFindPromptString` → heuristic: `/[\s]/.test(trimmed) || /[?.!,:;]/.test(trimmed)`
- `github.copilot-chat` passes because `.` matches `/[?.!,:;]/`
**Fix**:
- Preferred: Remove the entire fallback — VS Code puts the prompt in `messages`, not `options`
- Minimal: Require whitespace AND reject pure-identifier strings (no dots, hyphens, etc.)

### Issue #123 — Disable Connection Popup

**Type**: Feature
**Component**: src/extension-helpers.ts, src/extension.ts
**Problem**: No setting to suppress the "Cannot connect to Ollama server" popup when Ollama isn't running.
**Analysis**: `handleConnectionTestFailure` (extension-helpers.ts:67) calls `window.showErrorMessage()` unconditionally. Called from extension.ts:1312 at startup. The issue reporter wants the status bar indicator only, no popup.
**Fix**: Add a `opilot.showConnectionFailurePopup` setting (default: true). When false, skip the `showErrorMessage` call.

## Constraints

- Must maintain backward compatibility with existing settings
- `@agentsy/core` and `@agentsy/providers` are external dependencies — no changes needed to them
- All fixes must pass `task precommit` (ultracite check + type check + tests)
- Follow TypeScript strict mode, named exports, async/await patterns

## Exit Criteria

- [ ] All 5 issues have remediation plans reviewed and approved
- [ ] Each fix is implemented with passing tests
- [ ] Full precommit checks pass
