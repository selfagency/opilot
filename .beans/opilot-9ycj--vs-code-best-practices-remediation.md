---
# opilot-9ycj
title: VS Code best-practices remediation
status: todo
type: epic
priority: normal
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-14T21:39:39Z
---

Align the extension with current VS Code platform guidance where implementation gaps are already known.

## Included Findings

- 024 Deprecated `createStatusBarItem` overload used
- 025 `canBeReferencedInPrompt` not set on all applicable tools
- 026 No disambiguation config for the chat participant

## Todo

- [ ] Review current VS Code API usage and extension manifest contributions
- [ ] Create child issues for each platform-alignment finding
- [ ] Confirm behavior changes remain backward compatible
- [ ] Verify the epic covers all VS Code best-practice findings from the plan
