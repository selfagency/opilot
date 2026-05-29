# Aimock Test Migration - Quick Reference

## Installation

```bash
npm install --save-dev @copilotkit/aimock
```

## Basic Setup

```typescript
import { useOllamaMock, createChatFixture, addCustomFixture } from '../utils/aimock-utils';
import { Ollama } from 'ollama';

describe('My Tests', () => {
  const { mock, mockUrl } = useOllamaMock();

  beforeAll(async () => await mock.beforeAll());
  afterAll(async () => await mock.afterAll());

  it('should work', async () => {
    // Add fixture
    const fixture = createChatFixture('model', 'prompt', 'response');
    addCustomFixture(mock.mock, fixture);

    // Use real client
    const client = new Ollama({ host: mockUrl });
    const result = await client.chat({
      model: 'model',
      messages: [{ role: 'user', content: 'prompt' }],
      stream: false
    });

    expect(result.message.content).toBe('response');
  });
});
```

## Helper Functions

### createChatFixture(model, userMessage, assistantResponse, options?)

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

### createEmbeddingsFixture(model, prompt, embeddingDimension?)

```typescript
const fixture = createEmbeddingsFixture(
  'smollm:135m',
  'hello world',
  512
);
```

### createErrorFixture(method, path, errorMessage, status?)

```typescript
const fixture = createErrorFixture(
  'POST',
  '/api/chat',
  "model 'nonexistent' not found",
  404
);
```

### addCustomFixture(mock, fixture)

```typescript
addCustomFixture(mock.mock, fixture);
```

## Migration Checklist

- [ ] Add imports: `useOllamaMock`, `createChatFixture`, `addCustomFixture`, `Ollama`
- [ ] Remove `vi.mock('./client.js', ...)`
- [ ] Add `const { mock, mockUrl } = useOllamaMock();`
- [ ] Add `beforeAll(async () => await mock.beforeAll());`
- [ ] Add `afterAll(async () => await mock.afterAll());`
- [ ] Replace `vi.fn().mockResolvedValue()` with `createChatFixture()`
- [ ] Replace `getOllamaClient()` with `new Ollama({ host: mockUrl })`
- [ ] Update assertions to match real response structure
- [ ] Run tests: `npx vitest run`

## Common Patterns

### Chat Completion

```typescript
const fixture = createChatFixture('model', 'prompt', 'response');
addCustomFixture(mock.mock, fixture);

const client = new Ollama({ host: mockUrl });
const result = await client.chat({
  model: 'model',
  messages: [{ role: 'user', content: 'prompt' }],
  stream: false
});

expect(result.message.content).toBe('response');
```

### Embeddings

```typescript
const fixture = createEmbeddingsFixture('model', 'text', 512);
addCustomFixture(mock.mock, fixture);

const client = new Ollama({ host: mockUrl });
const result = await client.embeddings({
  model: 'model',
  prompt: 'text'
});

expect(result.embedding.length).toBe(512);
```

### Error Handling

```typescript
const fixture = createErrorFixture('POST', '/api/chat', 'Error message', 500);
addCustomFixture(mock.mock, fixture);

const client = new Ollama({ host: mockUrl });

await expect(
  client.chat({
    model: 'model',
    messages: [{ role: 'user', content: 'test' }],
    stream: false
  })
).rejects.toThrow();
```

## Pre-built Fixtures

Located in `test/fixtures/`:

- `ollama-chat.json` - Chat responses
- `ollama-embeddings.json` - Embeddings responses
- `ollama-errors.json` - Error scenarios

Automatically loaded by `useOllamaMock()`.

## Running Tests

```bash
# Run all tests
npx vitest run

# Run specific test file
npx vitest run src/provider.test.ts

# Run aimock examples
npx vitest run test/aimock-examples.test.ts

# Watch mode
npx vitest watch src/provider.test.ts

# With coverage
npx vitest run --coverage
```

## Troubleshooting

### Port Already in Use

✅ Auto-handled - uses port 0 for auto-assignment

### Fixture Not Matching

✅ Check `match.body` structure matches request exactly

### Tests Still Failing

✅ Verify `mockUrl` is used instead of hardcoded localhost

### Environment Variables

✅ `OLLAMA_HOST` automatically set during tests

## Files to Read

1. **test/MIGRATION_GUIDE.md** - General patterns
2. **test/PROVIDER_TEST_MIGRATION.md** - Specific examples
3. **test/AIMOCK_SETUP.md** - Complete reference
4. **test/aimock-examples.test.ts** - Working code

## Tests to Update (Priority Order)

1. src/provider.test.ts (HIGH)
2. src/completions.test.ts (HIGH)
3. src/openai-compat.test.ts (HIGH)
4. src/sidebar.test.ts (MEDIUM)
5. src/settings-webview.test.ts (MEDIUM)
6. src/extension.test.ts (LOW)

## Benefits

✅ Real HTTP layer testing  
✅ Better error coverage  
✅ Faster execution  
✅ Deterministic results  
✅ Reusable fixtures  
✅ Easier maintenance  

## Next Steps

1. Read test/MIGRATION_GUIDE.md
2. Run test/aimock-examples.test.ts
3. Start with src/provider.test.ts
4. Update one test at a time
5. Run full test suite
6. Commit changes
