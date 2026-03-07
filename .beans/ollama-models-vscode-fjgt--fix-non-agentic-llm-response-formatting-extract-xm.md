---
# ollama-models-vscode-fjgt
title: Fix non-agentic LLM response formatting — extract XML context into system message
status: todo
type: bug
priority: medium
created_at: 2026-03-07T17:18:02Z
updated_at: 2026-03-07T17:19:52Z
---

VS Code Copilot injects `<environment_info>`, `<workspace_info>`, `<selection>`, and `<file_context>` XML blocks as raw text inside user messages. These are not extracted before sending to Ollama. Small/non-agentic models echo the raw XML back in their responses instead of treating it as context.

## Root Cause

The extension passes the user message text verbatim to Ollama. The XML blocks should be extracted and forwarded as an Ollama `system` role message so models receive proper context without polluting the visible conversation.

## Todo

- [ ] In `src/provider.ts` `toOllamaMessages()`: before building `ollamaMessages`, scan user messages for XML context blocks matching `/<(environment_info|workspace_info|selection|file_context)[^>]*>[\s\S]*?<\/\1>/gi`
  - Extract matched blocks into a `systemContext` string
  - Prepend `{ role: 'system', content: systemContext }` as the first message (only on the first user turn)
  - Remove extracted blocks from user message text before adding to `ollamaMessages`
- [ ] In `src/extension.ts` `handleChatRequest()`: same XML extraction in the direct-Ollama path when building `ollamaMessages`
- [ ] Run `pnpm run compile` to verify TypeScript passes
- [ ] Run `pnpm run test` to verify unit tests still pass
