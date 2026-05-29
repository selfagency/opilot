# Package.json Update Guide

## Add aimock to devDependencies

Add this to your `package.json` devDependencies:

```json
{
  "devDependencies": {
    "@copilotkit/aimock": "^1.7.0"
  }
}
```

## Install

```bash
npm install
# or
pnpm install
```

## Verify Installation

```bash
npx -p @copilotkit/aimock llmock --version
```

## Update Vitest Config (Optional)

If you want to exclude aimock tests from the default test run, update `vitest.config.js`:

```javascript
export default defineConfig({
  test: {
    // ... existing config
    exclude: [
      'node_modules/**',
      'dist/**',
      'out/**',
      'scripts/**',
      'test/integration/**',
      'test/aimock-examples.test.ts'  // Add this line if you want to exclude
    ]
  }
});
```

Or keep it included to run all tests together.

## Run Tests

```bash
# Run all tests including aimock
npx vitest run

# Run only aimock tests
npx vitest run test/aimock-examples.test.ts

# Watch mode
npx vitest watch test/aimock-examples.test.ts

# With coverage
npx vitest run --coverage
```

## CI/CD Integration

Add to your GitHub Actions workflow:

```yaml
- name: Run Tests
  run: npm run test

- name: Run Integration Tests (requires Ollama)
  run: npm run test:integration
  if: runner.os == 'Linux'  # Only on Linux runners with Ollama
```

## Task Commands (Taskfile.yml)

Add these tasks to your Taskfile.yml:

```yaml
test-aimock:
  desc: Run aimock tests
  cmds:
    - npx vitest run test/aimock-examples.test.ts

test-aimock-watch:
  desc: Watch aimock tests
  cmds:
    - npx vitest watch test/aimock-examples.test.ts

test-all:
  desc: Run all tests (unit + aimock)
  cmds:
    - npx vitest run

test-integration:
  desc: Run integration tests (requires Ollama)
  cmds:
    - npx vitest run test/integration/ollama.test.ts
```

Then run with:

```bash
task test-aimock
task test-aimock-watch
task test-all
task test-integration
```
