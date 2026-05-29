# Aimock Setup for Opilot Testing

This guide explains how to use **aimock** to mock Ollama responses for testing the Opilot VS Code extension without requiring a running Ollama server.

## Overview

**aimock** is a zero-dependency mock infrastructure for AI applications. For Opilot, it provides:

- ✅ Mock Ollama chat and embeddings endpoints
- ✅ Deterministic, repeatable test results
- ✅ Fast test execution (no network latency)
- ✅ Realistic streaming simulation
- ✅ Error/chaos testing capabilities
- ✅ Vitest integration with auto-lifecycle

## Installation

```bash
npm install --save-dev @copilotkit/aimock
```

## Project Structure

```text
test/
├── fixtures/
│   ├── ollama-chat.json          # Chat completion fixtures
│   ├── ollama-embeddings.json    # Embeddings fixtures
│   └── ollama-errors.json        # Error/chaos fixtures
├── utils/
│   └── aimock-utils.ts           # Test utilities and helpers
├── aimock-examples.test.ts       # Example tests
└── integration/
    └── ollama.test.ts            # Live integration tests (requires Ollama)
```

## Quick Start

### 1. Basic Test with Auto-Lifecycle

```typescript
import { useOllamaMock } from './utils/aimock-utils';
import { Ollama } from 'ollama';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';

describe('Ollama Chat', () => {
  const { mock, mockUrl } = useOllamaMock();

  beforeAll(async () => {
    await mock.beforeAll();
  });

  afterAll(async () => {
    await mock.afterAll();
  });

  it('should mock chat response', async () => {
    const client = new Ollama({ host: mockUrl });
    const response = await client.chat({
      model: 'smollm:135m',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false
    });

    expect(response.message.content).toBe('Hello! How can I help you today?');
  });
});
```

### 2. Custom Fixtures at Runtime

```typescript
import { createChatFixture, addCustomFixture } from './utils/aimock-utils';

it('should use custom fixture', async () => {
  const fixture = createChatFixture(
    'my-model',
    'my prompt',
    'my response'
  );

  addCustomFixture(mock.mock, fixture);

  const client = new Ollama({ host: mockUrl });
  const response = await client.chat({
    model: 'my-model',
    messages: [{ role: 'user', content: 'my prompt' }],
    stream: false
  });

  expect(response.message.content).toBe('my response');
});
```

### 3. Error Testing

```typescript
import { createErrorFixture, addCustomFixture } from './utils/aimock-utils';

it('should handle 404 errors', async () => {
  const fixture = createErrorFixture(
    'POST',
    '/api/chat',
    "model 'nonexistent' not found",
    404
  );

  addCustomFixture(mock.mock, fixture);

  const client = new Ollama({ host: mockUrl });

  await expect(
    client.chat({
      model: 'nonexistent',
      messages: [{ role: 'user', content: 'test' }],
      stream: false
    })
  ).rejects.toThrow();
});
```

## Fixture Format

Fixtures are JSON files matching Ollama API responses. Each fixture has:

```json
{
  "match": {
    "method": "POST",
    "path": "/api/chat",
    "body": {
      "model": "smollm:135m",
      "messages": [...]
    }
  },
  "response": {
    "model": "smollm:135m",
    "message": {
      "role": "assistant",
      "content": "..."
    },
    "done": true,
    ...
  },
  "status": 200
}
```

### Match Rules

- `method`: HTTP method (GET, POST, etc.)
- `path`: API endpoint path
- `body`: Request body to match (optional, matches any if omitted)

### Response Format

Follow Ollama API response format:

- **Chat**: `{ model, message, done, total_duration, ... }`
- **Embeddings**: `{ model, embeddings }`
- **Errors**: `{ error }` with `status: 4xx/5xx`

## Helper Functions

### `useOllamaMock(options?)`

Vitest hook for automatic lifecycle management.

```typescript
const { mock, mockUrl } = useOllamaMock({
  port: 0,  // Auto-assign port
  fixtures: ['ollama-chat.json', 'ollama-embeddings.json']
});

beforeAll(async () => await mock.beforeAll());
afterAll(async () => await mock.afterAll());
```

### `createChatFixture(model, userMessage, assistantResponse, options?)`

Create a chat fixture dynamically.

```typescript
const fixture = createChatFixture(
  'smollm:135m',
  'hello',
  'Hi there!',
  {
    status: 200,
    totalDuration: 1_000_000_000,
    evalCount: 5
  }
);
```

### `createEmbeddingsFixture(model, prompt, embeddingDimension?)`

Create an embeddings fixture.

```typescript
const fixture = createEmbeddingsFixture(
  'smollm:135m',
  'hello world',
  512  // embedding dimension
);
```

### `createErrorFixture(method, path, errorMessage, status?)`

Create an error fixture.

```typescript
const fixture = createErrorFixture(
  'POST',
  '/api/chat',
  "model 'nonexistent' not found",
  404
);
```

### `addCustomFixture(mock, fixture)`

Add a fixture to the mock at runtime.

```typescript
addCustomFixture(mock.mock, fixture);
```

## Running Tests

### Run aimock tests only

```bash
npx vitest run test/aimock-examples.test.ts
```

### Run all unit tests (includes aimock)

```bash
npx vitest run
```

### Run integration tests (requires Ollama)

```bash
npx vitest run test/integration/ollama.test.ts
```

### Watch mode

```bash
npx vitest watch test/aimock-examples.test.ts
```

## Integration with Existing Tests

To add aimock to existing Opilot tests:

1. **Import utilities**:

   ```typescript
   import { useOllamaMock } from '../utils/aimock-utils';
   ```

2. **Set up mock**:

   ```typescript
   const { mock, mockUrl } = useOllamaMock();

   beforeAll(async () => await mock.beforeAll());
   afterAll(async () => await mock.afterAll());
   ```

3. **Use mock URL**:

   ```typescript
   const client = new Ollama({ host: mockUrl });
   ```

## Advanced Usage

### Record Real Responses

To record real Ollama responses as fixtures:

```bash
npx -p @copilotkit/aimock llmock --record --provider-ollama http://localhost:11434 -p 4010
```

This proxies to your real Ollama server and saves responses to `./fixtures/`.

### Replay at Different Speeds

```bash
npx -p @copilotkit/aimock llmock -p 4010 -f ./fixtures --replay-speed 2
```

Replays fixtures at 2× speed for faster testing.

### Chaos Testing

Add error fixtures to test error handling:

```typescript
const chaosFixture = createErrorFixture(
  'POST',
  '/api/chat',
  'Connection timeout',
  500
);

addCustomFixture(mock.mock, chaosFixture);
```

## Troubleshooting

### Port Already in Use

If you get "port already in use", the mock will auto-assign a free port (port: 0).

### Fixture Not Matching

Ensure the `match` criteria exactly match the request:

- Check HTTP method (POST, GET, etc.)
- Verify API path (`/api/chat`, `/api/embeddings`, etc.)
- Match request body structure

### Environment Variables

The mock automatically sets `OLLAMA_HOST` during tests. If you need to restore it:

```typescript
import { restoreOllamaEnv } from './utils/aimock-utils';

afterAll(() => {
  restoreOllamaEnv(originalHost);
});
```

## Next Steps

1. ✅ Run example tests: `npx vitest run test/aimock-examples.test.ts`
2. ✅ Add aimock to existing tests
3. ✅ Create custom fixtures for your test scenarios
4. ✅ Test error handling with chaos fixtures
5. ✅ Record real responses for realistic fixtures

## Resources

- [aimock Documentation](https://aimock.copilotkit.dev)
- [Ollama API Docs](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [Vitest Documentation](https://vitest.dev)
