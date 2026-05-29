---
title: Testing
---

The project has three layers of tests:

| Layer             | Runner             | When to use                                    |
| ----------------- | ------------------ | ---------------------------------------------- |
| Unit tests        | Vitest             | Core logic, pure functions, mocked VS Code API |
| Extension tests   | `@vscode/test-cli` | Full VS Code host, real extension activation   |
| Integration tests | Vitest             | Requires a running Ollama instance with models |

## Running Tests

```bash
task unit-tests             # unit tests only (fast, no VS Code needed)
task unit-test-coverage     # unit tests + HTML coverage report
task extension-tests        # VS Code integration tests
task integration-tests      # end-to-end tests (pulls models first)
```

## Unit Tests

Unit tests live alongside their source files as `<module>.test.ts`. They run with [Vitest](https://vitest.dev/) and do not require VS Code or Ollama.

```text
src/
  client.test.ts
  completions.test.ts
  diagnostics.test.ts
  extension.test.ts
  formatting.test.ts
  modelfiles.test.ts
  provider.test.ts
  sidebar.test.ts
```

### VS Code Mock

`vitest.config.js` aliases `vscode` → `src/test/vscode.mock.ts`. All tests use this mock by default — do not import `vscode` directly in unit tests.

If a test needs to override a specific mock behavior:

```ts
import { vi } from 'vitest';

vi.doMock('vscode', () => ({
  ...require('./test/vscode.mock'),
  window: { showErrorMessage: vi.fn() },
}));
```

### Writing Unit Tests

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('myFunction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do the expected thing', () => {
    const result = myFunction('input');
    expect(result).toBe('expected output');
  });
});
```

### Stubbing `process.platform`

Some extension code branches on `process.platform`. To test platform-specific paths without skipping on CI:

```ts
let platformDesc: PropertyDescriptor | undefined;

beforeEach(() => {
  platformDesc = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});

afterEach(() => {
  if (platformDesc) {
    Object.defineProperty(process, 'platform', platformDesc);
  }
});
```

This avoids `no-conditional-expect` lint warnings (do not put `expect()` calls inside `if (process.platform ...)` conditionals).

### Mocking the Ollama Client

```ts
import { vi } from 'vitest';

vi.mock('./client', () => ({
  createOllamaClient: vi.fn(() => ({
    list: vi.fn().mockResolvedValue({ models: [] }),
    chat: vi.fn().mockResolvedValue({ message: { content: 'hello' } }),
  })),
}));
```

## Coverage

The coverage target is **85%** or higher across all source files. Run:

```bash
task unit-test-coverage
```

This generates:

- Terminal summary
- HTML report at `coverage/index.html`
- `coverage/coverage-final.json` for CI

Analyze uncovered areas with:

```bash
node scripts/coverage-analysis.js
```

## Extension Tests

Extension tests run inside a real VS Code host using `@vscode/test-cli`. They test the full extension lifecycle: activation, command registration, sidebar initialization.

```bash
task extension-tests
```

Test files live in `test/extension/`. See `test/extension/index.mjs` for the runner configuration.

## Integration Tests

Integration tests (`vitest.integration.config.js`) test real Ollama API calls. They require:

1. A running Ollama instance at `http://localhost:11434` (or `OLLAMA_HOST`)
2. Models pulled — the test task handles this automatically:

```bash
task integration-tests   # pulls required models, then runs tests
```

Integration test files live in `test/integration/`.

## Lint

The project uses [oxlint](https://oxc.rs/docs/guide/usage/linter.html) with the `no-conditional-expect` rule enabled. Never place `expect()` calls inside conditionals.

```bash
task lint         # check
task lint-fix     # auto-fix
```

## Pre-commit Hook

Husky runs `task precommit` before every commit via lint-staged. This checks:

- TypeScript types (`task check-types`)
- Lint (`task lint-fix`)
- Formatting (`task check-formatting`)

Fix issues before committing:

```bash
task precommit
```
