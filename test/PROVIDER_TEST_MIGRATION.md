# Provider Test Migration Example

This file shows how to migrate `src/provider.test.ts` to use aimock.

## Current Approach (Manual Mocking)

```typescript
// Current: Using vi.fn() to mock Ollama client
vi.mock('./client.js', () => ({
  getOllamaClient: vi.fn(),
  getCloudOllamaClient: vi.fn()
}));

describe('OllamaChatModelProvider', () => {
  it('should handle chat response', async () => {
    const mockClient = {
      chat: vi.fn().mockResolvedValue({
        message: { content: 'response' },
        model: 'smollm:135m'
      })
    };

    (getOllamaClient as any).mockResolvedValue(mockClient);
    // ... test code
  });
});
```

## New Approach (Aimock)

```typescript
import { useOllamaMock, createChatFixture, addCustomFixture } from '../utils/aimock-utils';
import { Ollama } from 'ollama';

describe('OllamaChatModelProvider', () => {
  const { mock, mockUrl } = useOllamaMock();

  beforeAll(async () => {
    await mock.beforeAll();
  });

  afterAll(async () => {
    await mock.afterAll();
  });

  it('should handle chat response', async () => {
    // Create fixture for this specific test
    const fixture = createChatFixture(
      'smollm:135m',
      'test message',
      'test response'
    );
    addCustomFixture(mock.mock, fixture);

    // Use real Ollama client with mock server
    const client = new Ollama({ host: mockUrl });
    const response = await client.chat({
      model: 'smollm:135m',
      messages: [{ role: 'user', content: 'test message' }],
      stream: false
    });

    expect(response.message.content).toBe('test response');
  });
});
```

## Key Changes

1. **Remove vi.mock('./client.js')** - No need to mock client factory
2. **Add useOllamaMock()** - Provides mock server and URL
3. **Create fixtures** - Use `createChatFixture()` for each scenario
4. **Use real client** - `new Ollama({ host: mockUrl })`
5. **Update assertions** - Match real response structure

## Migration Checklist for provider.test.ts

- [ ] Add `import { useOllamaMock, createChatFixture, addCustomFixture } from '../utils/aimock-utils';`
- [ ] Add `import { Ollama } from 'ollama';`
- [ ] Remove `vi.mock('./client.js', ...)`
- [ ] Add `const { mock, mockUrl } = useOllamaMock();`
- [ ] Add `beforeAll(async () => await mock.beforeAll());`
- [ ] Add `afterAll(async () => await mock.afterAll());`
- [ ] Replace each `vi.fn().mockResolvedValue()` with `createChatFixture()`
- [ ] Replace `getOllamaClient` calls with `new Ollama({ host: mockUrl })`
- [ ] Update assertions to match real response structure
- [ ] Run tests: `npx vitest run src/provider.test.ts`

## Example Test Conversions

### Test 1: Basic Chat

**Before:**

```typescript
it('should send messages to Ollama', async () => {
  const mockClient = {
    chat: vi.fn().mockResolvedValue({
      message: { content: 'Hello!' },
      model: 'smollm:135m'
    })
  };
  (getOllamaClient as any).mockResolvedValue(mockClient);

  const provider = new OllamaChatModelProvider(mockClient, logger);
  const response = await provider.chat(messages);

  expect(mockClient.chat).toHaveBeenCalled();
  expect(response).toBe('Hello!');
});
```

**After:**

```typescript
it('should send messages to Ollama', async () => {
  const fixture = createChatFixture(
    'smollm:135m',
    'test',
    'Hello!'
  );
  addCustomFixture(mock.mock, fixture);

  const client = new Ollama({ host: mockUrl });
  const provider = new OllamaChatModelProvider(client, logger);
  const response = await provider.chat(messages);

  expect(response).toBe('Hello!');
});
```

### Test 2: Error Handling

**Before:**

```typescript
it('should handle chat errors', async () => {
  const mockClient = {
    chat: vi.fn().mockRejectedValue(new Error('Connection failed'))
  };
  (getOllamaClient as any).mockResolvedValue(mockClient);

  const provider = new OllamaChatModelProvider(mockClient, logger);

  await expect(provider.chat(messages)).rejects.toThrow('Connection failed');
});
```

**After:**

```typescript
it('should handle chat errors', async () => {
  const fixture = createErrorFixture(
    'POST',
    '/api/chat',
    'Connection failed',
    500
  );
  addCustomFixture(mock.mock, fixture);

  const client = new Ollama({ host: mockUrl });
  const provider = new OllamaChatModelProvider(client, logger);

  await expect(provider.chat(messages)).rejects.toThrow();
});
```

## Benefits

✅ Tests real HTTP layer  
✅ More realistic error scenarios  
✅ Reusable fixtures  
✅ Faster test execution  
✅ Better streaming support  
✅ Easier to maintain  

## Next Steps

1. Start with one test function
2. Run tests to verify
3. Move to next test function
4. Once all tests pass, remove old mocks
5. Commit changes
