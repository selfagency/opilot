---
# opilot-yexf
title: 'Security: review input sanitization and error message exposure'
status: completed
type: task
priority: normal
created_at: 2026-03-08T16:41:20Z
updated_at: 2026-03-08T17:41:46Z
id: opilot-yexf
---

Review user-facing and network-facing input handling for injection risks, and audit error messages to ensure no sensitive information (credentials, paths, internal state) is exposed to end users.

## Context

Two security concerns from the codebase review:

1. **Input sanitization** — `src/modelfiles.ts` parses Modelfile content from the editor, and `src/sidebar.ts` passes user-configured values into fetch URLs and request bodies. These paths haven't been reviewed for injection risks (e.g., header injection, path traversal, template injection in Modelfile content).

2. **Error message exposure** — `src/provider.ts` and `src/extension.ts` surface error messages to end users via `vscode.window.showErrorMessage`. Some error objects (e.g., from raw `fetch()` failures or Ollama API errors) may contain internal URLs, bearer tokens, or stack traces.

## Todo

- [ ] Audit Modelfile field parsing in `src/modelfiles.ts` for injection vulnerabilities
- [ ] Audit `fetch` URL construction in `src/sidebar.ts` for path traversal / header injection
- [ ] Audit error message content in `src/provider.ts` and `src/extension.ts` — strip or sanitize before showing to users
- [ ] Ensure no credentials or auth tokens appear in user-visible error dialogs or the log channel
- [ ] Document any intentional sanitization decisions inline

## Files

- `src/modelfiles.ts`
- `src/sidebar.ts`
- `src/provider.ts`
- `src/extension.ts`
