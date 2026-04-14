---
# ollama-models-vscode-z3t0
title: Implement @opilot/llm-stream-parser
status: completed
type: milestone
priority: high
created_at: 2026-03-11T16:57:13Z
updated_at: 2026-04-14T21:30:53Z
---

## Todo

- [x] Identify all local parser implementations to replace (ThinkingParser, XmlStreamFilter, extractXmlToolCalls, buildXmlToolSystemPrompt, splitLeadingXmlContextBlocks, dedupeXmlContextBlocksByTag, appendToBlockquote, sanitizeNonStreamingModelOutput, formatXmlLikeResponseForDisplay, stripXmlContextTags)
- [x] Move `@selfagency/llm-stream-parser` from devDependencies to dependencies in package.json
- [x] Remove `saxophone` from dependencies (now transitive via library)
- [x] Replace `src/thinkingParser.ts` with single-line re-export from library
- [x] Replace `src/formatting.ts` with thin re-exports + backward-compat wrapper for `splitLeadingXmlContextBlocks` (`remaining` → `content`)
- [x] Replace `src/toolUtils.ts` local implementations with re-exports; keep `normalizeToolParameters` and `isToolsNotSupportedError`
- [x] Update `src/provider.ts`: import `appendToBlockquote` from library, remove local function
- [x] Fix JSDoc bug in provider.ts that commented out `isThinkingModelId`
- [x] Fix TS1479 ESM/CJS interop: switch tsconfig to `"module": "preserve"` + `"moduleResolution": "Bundler"`
- [x] Update `tsup.config.mjs`: remove `saxophone` from `noExternal`
- [x] Fix test assertions for new `XmlToolCall.format` field (use `objectContaining`)
- [x] Fix trailing-space test for `splitLeadingXmlContextBlocks` in provider.test.ts
- [x] Verify: 556/556 tests pass, type check clean, build succeeds
- [ ] Create branch, commit, and open PR

## Summary of Changes

Replaced all locally-implemented parser code with re-exports from the newly published `@selfagency/llm-stream-parser` package:

- `src/thinkingParser.ts` → one-line re-export
- `src/formatting.ts` → thin re-exports with backward-compat wrapper (`remaining` → `content`)
- `src/toolUtils.ts` → re-exports + kept Ollama-specific utilities (`normalizeToolParameters`, `isToolsNotSupportedError`)
- `src/provider.ts` → `appendToBlockquote` imported from library
- `tsconfig.json` → `module: preserve` + `moduleResolution: Bundler` for ESM/CJS interop
- `tsup.config.mjs` → removed stale `saxophone` from `noExternal`
- `package.json` → `@selfagency/llm-stream-parser` moved to dependencies, `saxophone` removed
