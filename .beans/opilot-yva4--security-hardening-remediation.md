---
# opilot-yva4
title: Security hardening remediation
status: todo
type: epic
priority: high
created_at: 2026-04-14T21:37:16Z
updated_at: 2026-04-14T21:43:48Z
parent: opilot-fu6s
---

Eliminate risky patterns and harden security-sensitive code paths identified in the remediation plan.

## Included Findings

- 004 Shell command construction via string interpolation in `src/sidebar.ts`
- 005 Unsafe direct file write without locking in `src/extension.ts`
- 006 Static `journalctl` command assumes PATH availability
- 007 PowerShell script embedded as a string literal
- 008 Credentials may appear in URL-based error dialogs

## Todo

- [ ] Review all affected command execution and file mutation paths
- [ ] Create child issues for each security finding
- [ ] Identify any shared mitigations that can be handled once
- [ ] Verify the epic covers all security findings from the plan
