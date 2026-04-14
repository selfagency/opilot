---
# opilot-b14z
title: 'Phase 5: Modelfile Manager'
status: completed
type: feature
priority: high
created_at: 2026-03-05T21:11:25Z
updated_at: 2026-03-05T22:07:48Z
---

Implement Modelfile language support and a Modelfile Manager sidebar pane for the Ollama VS Code extension.

## Todo

- [x] Create `src/modelfiles.ts` — ModelfilesProvider, handleNewModelfile (interactive wizard), handleBuildModelfile, hover/completion providers, registerModelfileManager
- [x] Create `syntaxes/modelfile.tmLanguage.json` — syntax grammar (FROM, PARAMETER, SYSTEM, TEMPLATE, keywords, numbers)
- [x] Create `language-configuration.json` — `#` line comment, triple-quote autoclosing
- [x] Update `package.json` — `ollama-modelfiles` view, 5 new commands, language/grammar, `ollama.modelfilesPath` setting
- [x] Update `src/extension.ts` — call `registerModelfileManager(context, client, diagnostics)`
- [x] Update `src/contributes.test.ts` — 2 new tests
- [x] Update `src/extension.test.ts` — add mock for `registerModelfileManager` to all 8 tests
- [x] Implement interactive New Modelfile wizard: name input → local model quick pick → system prompt input → create/save/open
- [x] Write and pass 4 unit tests for wizard (122 total passing)
- [x] Update README.md with Modelfile Manager section
- [x] Commit + push + open PR #8

## Summary of Changes

**New files:**

- `src/modelfiles.ts` — full Modelfile Manager implementation (~200 lines)
- `src/modelfiles.test.ts` — unit tests for wizard + provider
- `syntaxes/modelfile.tmLanguage.json` — TextMate syntax grammar
- `language-configuration.json` — comment/autoclosing config

**Modified files:**

- `package.json` — view, commands, language, grammar, setting contributions
- `src/extension.ts` — `registerModelfileManager` wired into activation
- `src/extension.test.ts` — mock for registerModelfileManager
- `src/contributes.test.ts` — 2 new tests
- `src/sidebar.ts` / `src/sidebar.test.ts` — minor consistency updates
- `README.md` — Modelfile Manager section

**Test result:** 122 unit tests passing
