---
# ollama-models-vscode-u168
title: Add running/stopped icons to left side of running models
status: in-progress
type: fix
priority: medium
branch: fix/168-running-stopped-icons
created_at: 2026-03-05T22:02:56Z
updated_at: 2026-03-06T14:42:56Z
---

Use circle-play and stop-circle for the icons and stop and play for the clickable actions

## Todo

- [x] Set bean status to in-progress
- [x] Locate sidebar rendering and command contribution points
- [ ] Add failing tests for left-side status icons on local/cloud running+stopped model items
- [ ] Implement `ThemeIcon` assignment in `ModelTreeItem` for running/stopped states
- [ ] Update command contribution icons to `$(play)` and `$(stop)` for clickable actions
- [ ] Run focused tests for `sidebar` and then full unit test suite
- [ ] Verify inline context-menu behavior manually in the tree views
