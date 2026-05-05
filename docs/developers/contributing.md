---
title: Contributing
---

Thank you for contributing to **Opilot**!

## Before You Start

1. Search [existing issues](https://github.com/selfagency/opilot/issues) to see if your bug or feature is already tracked.
2. For significant changes, open an issue first to discuss the approach.
3. Fork the repository and clone your fork.

## Branch Naming

All work happens on feature branches:

```
<type>/<issue-number>-<short-description>
```

**Examples:**

```
feat/42-vision-support
fix/87-connection-timeout
docs/50-api-reference
refactor/99-provider-cleanup
```

Supported types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`.

## Development Loop

```bash
# 1. Create a branch
git checkout -b feat/42-my-feature

# 2. Install dependencies (first time)
pnpm install

# 3. Start watch mode for fast iteration
task watch

# 4. Open Extension Development Host
# Press F5 in VS Code

# 5. Make your changes

# 6. Run tests
task unit-tests

# 7. Run pre-commit checks before staging
task precommit

# 8. Commit
git add -p
git commit -m "feat: add my feature"
```

## Key Dependencies

| Package                                                                    | Purpose                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`@agentsy/vscode`](https://www.npmjs.com/package/@agentsy/vscode)         | VS Code chat renderer and extension-focused integration helpers     |
| [`@agentsy/context`](https://www.npmjs.com/package/@agentsy/context)       | XML context block splitting/deduplication                           |
| [`@agentsy/formatting`](https://www.npmjs.com/package/@agentsy/formatting) | Display-safe formatting and markdown helpers (`appendToBlockquote`) |
| [`@agentsy/thinking`](https://www.npmjs.com/package/@agentsy/thinking)     | Thinking-tag parsing                                                |
| [`@agentsy/tool-calls`](https://www.npmjs.com/package/@agentsy/tool-calls) | XML/native tool call helpers                                        |
| [`@agentsy/xml-filter`](https://www.npmjs.com/package/@agentsy/xml-filter) | Streaming XML/privacy filtering                                     |
| [`ollama`](https://github.com/ollama/ollama-js)                            | Official Ollama JS SDK                                              |

## Code Style

The project uses [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for linting and [oxfmt](https://github.com/oxc-project/oxfmt) for formatting.

Run both:

```bash
task lint-fix         # auto-fix lint issues
task check-formatting # verify formatting
```

Formatting is enforced on commit via Husky + lint-staged.

**Key conventions:**

- TypeScript only — `never` use `any`
- No hardcoded shell strings for process invocation — always use argument arrays
- Secrets go in VS Code `SecretStorage`, never in settings or state
- Use `reportError(logger, error, { showToUser })` from `errorHandler.ts` for error handling
- Use `DiagnosticsLogger` from `diagnostics.ts` for all logging (no `console.log`)

## Test-Driven Development

Write tests before code. The coverage target is **85%** or higher.

```bash
task unit-tests             # run tests
task unit-test-coverage     # run with coverage report
```

Tests live alongside source files as `*.test.ts`. The VS Code API is mocked via `src/test/vscode.mock.ts`.

See [Testing](./testing) for full details.

## Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer: Closes #<issue>]
```

**Examples:**

```
feat(completions): add FIM prompt format support
fix(sidebar): normalize Content-Type header before parsing
test(provider): add tool invocation error recovery tests
docs: add inline completions guide
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`.

## Pull Requests

1. Push your branch and open a PR against `main`
2. Fill out the PR template
3. Ensure all CI checks pass:
   - Type check (`task check-types`)
   - Lint (`task lint`)
   - Unit tests (`task unit-tests`)
   - Extension tests (`task extension-tests`)
4. Request a review
5. Squash merge after approval

## What Makes a Good PR

- **Focused**: one feature or fix per PR
- **Tested**: new behavior covered by unit tests
- **Clean**: `task precommit` passes with no warnings
- **Described**: the PR body explains _why_, not just _what_
- **Small**: prefer multiple smaller PRs over one large one

## Reporting Bugs

Include:

- OS and VS Code version
- Extension version
- Ollama version (`ollama --version`)
- Steps to reproduce
- Expected vs. actual behavior
- Relevant output from **Opilot** output channel (with `ollama.diagnostics.logLevel: "debug"`)

## Feature Requests

Open an issue with the `enhancement` label. Describe:

- The use case (what you want to do, not just what to build)
- Why existing functionality doesn't cover it
- Any API/implementation ideas you have
