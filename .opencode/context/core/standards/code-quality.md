# Project Code Quality Standards

This file codifies the repository's mandatory code-quality and contributor conventions. It is synthesized from AGENTS.md, Taskfile, biome.json, and existing project-intelligence files. Maintain clarity and keep changes minimal.

## Purpose

- Provide a single, discoverable location describing linting, formatting, typechecking, testing, and commit/branch conventions used by automated tools and human contributors.

## Tooling (canonical)

- Package manager: pnpm (pnpm-lock.yaml present). Use `pnpm install` locally; CI uses `pnpm install --frozen-lockfile`.
- Lint & format: Ultracite (Biome preset). Commands:
  - Check: `pnpm dlx ultracite check`
  - Fix: `pnpm dlx ultracite fix`
  - Diagnose: `pnpm dlx ultracite doctor`
- Tasks: `Taskfile.yaml` / `Taskfile.yml` contains high-level commands (lint, compile, unit-tests, precommit).
- Testing: Vitest. Run unit tests with `task unit-tests` or the underlying vitest command.

## Type Safety

- TypeScript with strict settings is preferred. Prefer explicit types; prefer `unknown` to `any` where appropriate.

## Branching & Commits

- Branch name format: `[type]/[short-title]` (e.g., `feat/add-ollama-integration`).
- Create topic branches from `develop` unless instructed otherwise.
- Commit messages: Conventional Commits (type(scope?): subject). Keep subject ≤ 50 chars.

## Pre-commit & CI gates

- Run precommit checks before committing: `task precommit` (runs lint, tests, formatting checks as configured).
- CI runs: lint, typecheck, unit tests, integration-tests (see .github/workflows/*). Fix issues locally before pushing.

## Tests

- Write assertions inside `it()`/`test()` blocks. Avoid `.only` and `.skip` in committed code.
- Coverage target: 85% (repository goal for change acceptance).

## Code Style & Patterns (high level)

- Prefer readability and explicitness over cleverness. Keep functions focused and small.
- Prefer `for...of` over `.forEach()` for async flows. Use arrow functions for callbacks.
- Use optional chaining and nullish coalescing for safer property access.

## Error Handling & Security

- Throw `Error` objects with descriptive messages. Avoid swallowing errors.
- Validate and sanitize external input; no use of `eval()`.

## When in Doubt

- If Biome/Ultracite cannot express a rule, prefer human-readable guidance in code comments or this file and open an issue referencing the rule.

## Maintenance

- Keep this file small and actionable. Update when CI/tooling changes.
