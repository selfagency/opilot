---
# opilot-q7wq
title: 'Dependency audit: security, updates, and license review'
status: completed
type: task
priority: high
created_at: 2026-03-08T16:41:06Z
updated_at: 2026-03-08T16:54:38Z
id: opilot-q7wq
---

Run a full dependency security audit, update outdated packages, and verify dependency licenses to reduce supply-chain risk.

## Context

The project's npm dependencies have not been audited in this round of improvements. Vulnerabilities, outdated packages, and incompatible licenses all represent risk.

## Todo

- [ ] Run `pnpm audit` and review the report
- [ ] Fix any high/critical severity vulnerabilities (update or replace packages)
- [ ] Run `pnpm outdated` and review the list of outdated direct dependencies
- [ ] Update dependencies with non-breaking upgrades (patch/minor versions)
- [ ] For major-version upgrades, assess breaking changes before updating
- [ ] Verify licenses of direct dependencies are compatible with the extension's license (MIT)
- [ ] Run `task compile` and `task unit-tests` to confirm nothing is broken after updates

## Files

- `package.json`
- `pnpm-lock.yaml`
