# Migrating Tests to Aimock

This guide explains how to migrate existing Opilot tests from manual mocking to using aimock.

## Before: Manual Mocking

```typescript
// Old approach: Manual vi.fn() mocks
const client = { 
  chat: vi.fn().mockResolvedValue({
    message: { content: 'response' }
  })
};
```

## After: Aimock Fixtures

```typescript
// New approach: Aimock with fixtures
import { useOllamaMock } from '../utils/aimock-utils';

const { mock, mockUrl } = useOllamaMock();

beforeAll(async () => await mock.beforeAll());
afterAll(async () => await mock.afterAll());

// Now use real Ollama client with mock server
const client = new Ollama({ host: mockUrl });
```

## Migration Patterns

### Pattern 1: Chat Completions

**Before:**

```typescript
const client = {
  chat: vi.fn().mockResolvedValue({
    message: { content: 'Hello!' },
    model: 'smollm:135m'
  })
};
```

**After:**

```typescript
import { useOllamaMock, createChatFixture, addCustomFixture } from '../utils/aimock-utils';

const { mock, mockUrl } = useOllamaMock();

beforeAll(async () => await mock.beforeAll());
afterAll(async () => await mock.afterAll());

it('should handle chat', async () => {
  const fixture = createChatFixture(
    'smollm:135m',
    'hello',
    'Hello!'
  );
  addCustomFixture(mock.mock, fixture);

  const client = new Ollama({ host: mockUrl });
  const response = await client.chat({
    model: 'smollm:135m',
    messages: [{ role: 'user', content: 'hello' }],
    stream: false
  });

  expect(response.message.content).toBe('Hello!');
});
```

### Pattern 2: Embeddings

**Before:**

```typescript
const client = {
  embeddings: vi.fn().mockResolvedValue({
    embedding: [0.1, 0.2, 0.3]
  })
};
```

**After:**

```typescript
import { useOllamaMock, createEmbeddingsFixture, addCustomFixture } from '../utils/aimock-utils';

const { mock, mockUrl } = useOllamaMock();

beforeAll(async () => await mock.beforeAll());
afterAll(async () => await mock.afterAll());

it('should handle embeddings', async () => {
  const fixture = createEmbeddingsFixture(
    'smollm:135m',
    'hello world',
    3
  );
  addCustomFixture(mock.mock, fixture);

  const client = new Ollama({ host: mockUrl });
  const response = await client.embeddings({
    model: 'smollm:135m',
    prompt: 'hello world'
  });

  expect(response.embedding.length).toBe(3);
});
```

### Pattern 3: Error Handling

**Before:**

```typescript
const client = {
  chat: vi.fn().mockRejectedValue(new Error('Model not found'))
};
```

**After:**

```typescript
import { useOllamaMock, createErrorFixture, addCustomFixture } from '../utils/aimock-utils';

const { mock, mockUrl } = useOllamaMock();

beforeAll(async () => await mock.beforeAll());
afterAll(async () => await mock.afterAll());

it('should handle errors', async () => {
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

## Benefits of Migration

1. **More Realistic** - Uses real Ollama client, not mocks
2. **Better Coverage** - Tests actual HTTP layer
3. **Easier Maintenance** - Fixtures are reusable
4. **Faster Tests** - No network latency
5. **Better Error Testing** - Realistic error responses
6. **Streaming Support** - Can test streaming responses

## Tests to Migrate

Priority order:

1. **High Priority** (interact with Ollama API):
   - `src/provider.test.ts` - Chat provider
   - `src/completions.test.ts` - Inline completions
   - `src/openai-compat.test.ts` - OpenAI compatibility

2. **Medium Priority** (use Ollama client):
   - `src/sidebar.test.ts` - Model management
   - `src/settings-webview.test.ts` - Settings

3. **Low Priority** (minimal Ollama interaction):
   - `src/extension.test.ts` - Extension lifecycle
   - `src/modelfiles.test.ts` - Modelfile handling

## Step-by-Step Migration

1. Add `useOllamaMock()` hook to test suite
2. Replace `vi.fn()` mocks with `createChatFixture()` / `createEmbeddingsFixture()`
3. Use `addCustomFixture()` to add fixtures at runtime
4. Replace mock client with real `new Ollama({ host: mockUrl })`
5. Update assertions to match real response structure
6. Run tests: `npx vitest run`

## Common Issues

### Issue: "Cannot reach Ollama"

**Solution**: Use `mockUrl` from `useOllamaMock()` instead of hardcoded localhost

### Issue: Fixture not matching

**Solution**: Ensure `match.body` exactly matches request structure

### Issue: Tests still using vi.fn()

**Solution**: Replace with fixture-based approach for Ollama calls

## Rollback

If needed, revert to manual mocking:

```typescript
// Keep both approaches during transition
const { mock, mockUrl } = useOllamaMock();
const manualMock = { chat: vi.fn() };

// Use whichever is appropriate
```

## Next Steps

1. Start with `provider.test.ts`
2. Migrate one test at a time
3. Run tests after each migration
4. Update other tests following same pattern
5. Remove manual mocks once all tests migrated
