---
# ollama-models-vscode-xu20
title: Fix XML context tags leaking into chat output
status: completed
type: bug
priority: high
created_at: 2026-03-08T23:39:18Z
updated_at: 2026-03-09T01:23:26Z
---

## Todo

- [ ] Add regression tests for repeated <user_info>/<workspace_info> leakage
- [ ] Refactor shared context extraction/dedup helper
- [ ] Unify non-stream fallback sanitation pipeline
- [ ] Validate provider + @ollama paths
- [ ] Run tests and compile

## Notes

User reports repeated XML context blocks in visible output. Goal: context tags should never be user-visible; non-context XML should still format to markdown.
