---
# ollama-models-vscode-u168
title: Add running/stopped icons to left side of running models
status: completed
type: fix
priority: medium
created_at: 2026-03-05T22:02:56Z
updated_at: 2026-03-07T02:17:32Z
---

Use circle-play and stop-circle for the icons and stop and play for the clickable actions

## Todo

- [x] Set bean status to in-progress
- [x] Locate sidebar rendering and command contribution points
- [x] Add failing tests for left-side status icons on local/cloud running+stopped model items
- [x] Implement status icon assignment in `ModelTreeItem` for running/stopped states
- [x] Fix tree iconPath runtime crash by using real `ThemeIcon` instances
- [x] Update command contribution icons to `$(play)` and `$(stop)` for clickable actions
- [x] Run focused tests for `sidebar` and then full unit test suite
- [ ] Verify inline context-menu behavior manually in the tree views
