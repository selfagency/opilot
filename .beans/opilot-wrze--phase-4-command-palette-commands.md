---
# opilot-wrze
title: 'Phase 4: Command Palette Commands'
status: completed
type: feature
priority: high
created_at: 2026-03-05T20:07:15Z
updated_at: 2026-03-05T20:35:08Z
---

Implement Phase 4: Command Palette Commands (Cmd+Shift+P) for the Ollama VS Code extension.

Commands to expose to users:

- `ollama-copilot.pullModel` — Pull / download a model by name
- `ollama-copilot.manageAuthToken` — Manage local Ollama auth token (already registered, needs palette title)
- `ollama-copilot.manageCloudApiKey` — Manage Ollama Cloud API key (already registered, needs palette title)
- `ollama-copilot.refreshSidebar` — Refresh all sidebar panes
- `ollama-copilot.sortLibraryByName` / `ollama-copilot.sortLibraryByRecency` — Toggle library sort

## Todo

- [x] Audit `package.json` commands — ensure each palette-worthy command has a descriptive `title` and correct `category`
- [x] Add `"category": "Ollama"` to all commands so they group under "Ollama:" in the palette
- [x] Ensure `ollama-copilot.pullModel` triggers the pull input box (already implemented in sidebar.ts)
- [x] Register any missing commands in `extension.ts` `activate()` — all 18 already registered
- [x] Add `contributes.test.ts` checks: every palette command has a `category` field
- [x] Run all tests and verify they pass (110 passing)
