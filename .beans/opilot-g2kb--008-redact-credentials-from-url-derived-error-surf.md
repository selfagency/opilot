---
# opilot-g2kb
title: 008 Redact credentials from URL-derived error surfaces
status: todo
type: bug
priority: low
created_at: 2026-04-14T21:38:28Z
updated_at: 2026-04-14T21:38:28Z
parent: opilot-yva4
id: opilot-g2kb
---

Source issue 008 from `docs/plans/remediation-plan.md`.

## Summary

Connection errors derived from URLs can leak credential-bearing host strings into dialogs or logs.

## Files

- `src/client.ts`
- any shared URL/error formatting helpers involved in connection testing

## Remediation Goal

Ensure hosts and URLs are sanitized before they reach logs, thrown errors, or VS Code notifications.

## Todo

- [ ] Trace how host configuration is transformed into displayed error messages
- [ ] Introduce a safe redaction helper for credential-bearing URLs
- [ ] Apply the helper consistently in connection and transport error paths
- [ ] Add tests covering authenticated and unauthenticated host formats
- [ ] Verify diagnostics remain useful without exposing secrets
