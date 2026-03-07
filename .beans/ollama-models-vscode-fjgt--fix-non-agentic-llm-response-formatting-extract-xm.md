---
# ollama-models-vscode-fjgt
title: Fix non-agentic LLM response formatting — extract XML context into system message
status: completed
type: bug
priority: medium
created_at: 2026-03-07T17:18:02Z
updated_at: 2026-03-07T17:30:17Z
branch: fix/fjgt-xml-context-extraction
---

VS Code Copilot injects `<environment_info>`, `<workspace_info>`, `<selection>`, and `<file_context>` XML blocks as raw text inside user messages. These are not extracted before sending to Ollama. Small/non-agentic models echo the raw XML back in their responses instead of treating it as context.

## Root Cause

The extension passes the user message text verbatim to Ollama. The XML blocks should be extracted and forwarded as an Ollama `system` role message so models receive proper context without polluting the visible conversation.

## Library Research

Candidates for parsing/extracting the XML context blocks:

- **`fast-xml-parser`** (66M weekly downloads, MIT) — industry standard, pure TS/JS, no native deps. Can parse a doc wrapped in a root element to extract known tags. Already used by VS Code itself internally. Best choice for stability. `npm i fast-xml-parser`
- **`@luciformresearch/xmlparser`** (15 weekly downloads) — explicitly designed for LLM XML pipelines with permissive/error-recovery mode. Low adoption is a risk.
- **`llm-xml-parser`** (ocherry341) — designed for streaming LLM XML output; overkill for static extraction.
- **Plain regex** — simplest for the known fixed tag set (`environment_info`, `workspace_info`, `selection`, `file_context`). Pattern: `/<(environment_info|workspace_info|selection|file_context)[^>]*>[\s\S]*?<\/\1>/gi`. Reliable for these well-defined tags with no nesting edge cases.

**Recommendation:** Evaluate `fast-xml-parser` first (already likely in the dep tree via VS Code). If adding a dep is not desirable, the regex approach is perfectly adequate for this fixed tag set.

## Todo

- [ ] Check whether `fast-xml-parser` is already available (peer dep via VS Code or existing deps) before adding it
- [ ] In `src/provider.ts` `toOllamaMessages()`: extract XML context blocks from user message text
  - If using `fast-xml-parser`: wrap text in `<root>` element, parse with `XMLParser`, extract known tag values, rejoin into system context string
  - If using regex: match `/<(environment_info|workspace_info|selection|file_context)[^>]*>[\s\S]*?<\/\1>/gi`, collect matches into `systemContext`, strip from user text
  - Prepend `{ role: 'system', content: systemContext }` as first message (first user turn only)
- [ ] In `src/extension.ts` `handleChatRequest()`: same XML extraction in the direct-Ollama path when building `ollamaMessages`
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
