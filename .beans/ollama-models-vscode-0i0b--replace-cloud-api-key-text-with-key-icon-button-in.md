---
# ollama-models-vscode-0i0b
title: Replace cloud API key text with key icon button in panel header
status: in-progress
type: fix
priority: low
created_at: 2026-03-05T22:03:25Z
updated_at: 2026-03-06T06:04:11Z
---

## Todo

- [x] Write failing test: navigation-group view/title commands must have an icon
- [x] Add `"icon": "$(key)"` to `manageCloudApiKey` command in package.json
- [x] Add `"icon": "$(key)"` to `manageAuthToken` command in package.json
- [x] Add `manageAuthToken` to `ollama-local-models` view/title header (navigation@9)
- [x] Run tests green
- [x] Commit and push
