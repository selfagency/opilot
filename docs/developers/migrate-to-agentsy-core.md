# Migration Plan: `@selfagency/llm-stream-parser` → `@agentsy/core`

**Date**: 2026-05-27
**Status**: Complete

## Context

Opilot currently depends on `@selfagency/llm-stream-parser` (v0.3.1) for LLM stream parsing utilities: thinking block extraction, XML context tag handling, tool call parsing, and response formatting. The `@agentsy` monorepo now provides equivalent (and expanded) functionality through `@agentsy/core` and related packages.

## Goal

Replace `@selfagency/llm-stream-parser` with `@agentsy/core` as the stream parsing dependency. This is a mechanical import swap — all exported APIs exist in `@agentsy/core` with matching signatures.

## API Surface Mapping

| Opilot import (old) | @agentsy/core import (new) | Status |
|---|---|---|
| `@selfagency/llm-stream-parser/context` → `splitLeadingXmlContextBlocks` | `@agentsy/core/context` → `splitLeadingXmlContextBlocks` | ✅ Direct match |
| `@selfagency/llm-stream-parser/context` → `dedupeXmlContextBlocksByTag` | `@agentsy/core/context` → `dedupeXmlContextBlocksByTag` | ✅ Direct match |
| `@selfagency/llm-stream-parser/context` → `stripXmlContextTags` | `@agentsy/core/context` → `stripXmlContextTags` | ✅ Direct match |
| `@selfagency/llm-stream-parser/formatting` → `formatXmlLikeResponseForDisplay` | `@agentsy/core/formatting` → `formatXmlLikeResponseForDisplay` | ✅ Direct match |
| `@selfagency/llm-stream-parser/formatting` → `sanitizeNonStreamingModelOutput` | `@agentsy/core/formatting` → `sanitizeNonStreamingModelOutput` | ✅ Direct match |
| `@selfagency/llm-stream-parser/xml-filter` → `createXmlStreamFilter` | `@agentsy/core/xml-filter` → `createXmlStreamFilter` | ✅ Direct match |
| `@selfagency/llm-stream-parser/xml-filter` → `XmlStreamFilter` (type) | `@agentsy/core/xml-filter` → `XmlStreamFilter` (interface) | ✅ Direct match |
| `@selfagency/llm-stream-parser/thinking` → `ThinkingParser` | `@agentsy/core/thinking` → `ThinkingParser` | ✅ Direct match |
| `@selfagency/llm-stream-parser/tool-calls` → `buildXmlToolSystemPrompt` | `@agentsy/core/tool-calls` → `buildXmlToolSystemPrompt` | ✅ Direct match |
| `@selfagency/llm-stream-parser/tool-calls` → `extractXmlToolCalls` | `@agentsy/core/tool-calls` → `extractXmlToolCalls` | ✅ Direct match |
| `@selfagency/llm-stream-parser/tool-calls` → `XmlToolCall` (type) | `@agentsy/core/tool-calls` → `XmlToolCall` (interface) | ✅ Direct match |
| `@selfagency/llm-stream-parser/tool-calls` → `XmlToolInfo` (type) | `@agentsy/core/tool-calls` → `XmlToolInfo` (interface) | ✅ Direct match |
| `@selfagency/llm-stream-parser/markdown` → `appendToBlockquote` | `@agentsy/core/formatting` → `appendToBlockquote` | ⚠️ Subpath changed |

## Breaking Change

`appendToBlockquote` moves from `/markdown` subpath to `/formatting` subpath. The function signature is identical.

## Files to Change

### Source Files (6)

1. **`package.json`** — Replace dependency
2. **`tsup.config.mjs`** — Update `noExternal` regex pattern
3. **`src/formatting.ts`** — Update all import paths
4. **`src/thinkingParser.ts`** — Update import path
5. **`src/toolUtils.ts`** — Update import paths
6. **`src/provider.ts`** — Update `appendToBlockquote` import (subpath change)

### Documentation Files (3)

7. **`docs/developers/architecture.md`** — Update package references
8. **`docs/developers/contributing.md`** — Update package references
9. **`docs/developers/index.md`** — Update package references

### Changelog (1)

10. **`CHANGELOG.md`** — Add migration entry

## Future Work (Out of Scope)

- Adopting `@agentsy/providers/normalizers` for Ollama chunk normalization
- Adopting `@agentsy/vscode`'s `createVSCodeChatRenderer` for chat participant output rendering
- Adding a provider-specific bridge to `@agentsy/vscode` for `progress.report()`-based rendering
- Rewriting the chat participant orchestration loop (tool invocation, retries, fallbacks)

## Verification

After changes:

```bash
pnpm install
pnpm build
pnpm check-types
pnpm test
```
