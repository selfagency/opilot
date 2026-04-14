---
# opilot-l4x7
title: Document tool calling flow, XML context extraction, cloud auth, and Modelfile keywords
status: completed
type: task
priority: low
created_at: 2026-03-08T16:40:54Z
updated_at: 2026-03-08T17:37:23Z
id: opilot-l4x7
---

Add inline code comments and/or JSDoc blocks covering the four under-documented subsystems: tool calling flow, XML context tag extraction, cloud model authentication, and Modelfile PARAMETER keywords.

## Context

`docs/ARCHITECTURE.md` gives a high-level overview, but the following code paths lack inline documentation making them hard to onboard into:

1. **Tool calling flow** (`src/provider.ts`) — the full round-trip from receiving a LM tool call request to dispatching it and returning results
2. **XML context tag extraction** (`src/extension.ts`) — how VS Code XML context blocks are extracted from leading user messages, deduplicated, and prepended as system context
3. **Cloud model authentication** (`src/sidebar.ts`) — how Ollama Cloud credentials are obtained, validated, and refreshed
4. **Modelfile PARAMETER keywords** (`src/modelfiles.ts`) — which keywords are recognized, their expected value types, and where the list comes from

## Todo

- [ ] Add JSDoc / block comments to the tool calling round-trip in `src/provider.ts`
- [ ] Add comments to the context extraction logic in `src/extension.ts`
- [ ] Add comments to the cloud auth flow in `src/sidebar.ts`
- [ ] Verify / expand the PARAMETER_DOCS constant comment block in `src/modelfiles.ts`
- [ ] No behavior changes — comments only

## Files

- `src/provider.ts`
- `src/extension.ts`
- `src/sidebar.ts`
- `src/modelfiles.ts`
