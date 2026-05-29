# Test Update Summary: Migrating to Aimock

## Overview

All Opilot tests that interact with Ollama can now use aimock instead of manual mocking. This provides more realistic testing with real HTTP layer interaction.

## Files Created

1. **test/MIGRATION_GUIDE.md** - General migration patterns
2. **test/PROVIDER_TEST_MIGRATION.md** - Specific provider.test.ts examples
3. **test/utils/aimock-utils.ts** - Reusable test utilities
4. **test/aimock-examples.test.ts** - Working examples
5. **test/fixtures/** - Pre-built fixtures

## Tests to Update

### High Priority (Direct Ollama Interaction)

1. **src/provider.test.ts** (3007 lines)
   - Tests OllamaChatModelProvider
   - Currently uses `vi.mock('./client.js')`
   - **Migration**: Replace with `useOllamaMock()` + fixtures

2. **src/completions.test.ts**
   - Tests OllamaInlineCompletionProvider
   - Currently uses `vi.fn()` for client.generate
   - **Migration**: Use `createChatFixture()` for completions

3. **src/openai-compat.test.ts**
   - Tests OpenAI compatibility layer
   - Currently mocks HTTP responses
   - **Migration**: Use aimock fixtures

### Medium Priority (Ollama Client Usage)

4. **src/sidebar.test.ts** (128k+ lines)
   - Tests model management UI
   - Uses mocked Ollama client
   - **Migration**: Use `useOllamaMock()` for model listing

5. **src/settings-webview.test.ts**
   - Tests settings UI
   - Mocks configuration
   - **Migration**: Use fixtures for model validation

### Low Priority (Minimal Ollama Interaction)

6. **src/extension.test.ts** (126k+ lines)
   - Tests extension lifecycle
   - Minimal Ollama interaction
   - **Migration**: Optional, can keep manual mocks

7. **src/modelfiles.test.ts**
   - Tests modelfile parsing
   - No direct Ollama calls
   - **Migration**: Not needed

## Migration Steps

### Step 1: Update provider.test.ts

```bash
# 1. Read migration guide
cat test/PROVIDER_TEST_MIGRATION.md

# 2. Update imports
# Add: import { useOllamaMock, createChatFixture, addCustomFixture } from '../utils/aimock-utils';
# Add: import { Ollama } from 'ollama';

# 3. Replace vi.mock('./client.js') with useOllamaMock()

# 4. Update each test to use fixtures

# 5. Run tests
npx vitest run src/provider.test.ts
```

### Step 2: Update completions.test.ts

```bash
# Similar process as provider.test.ts
# Focus on createChatFixture() for code generation
```

### Step 3: Update openai-compat.test.ts

```bash
# Use fixtures for OpenAI API responses
```

### Step 4: Update sidebar.test.ts

```bash
# Use fixtures for model listing
```

### Step 5: Update settings-webview.test.ts

```bash
# Use fixtures for model validation
```

## Code Patterns

### Pattern 1: Replace vi.fn() Mock

**Before:**

```typescript
const mockClient = {
  chat: vi.fn().mockResolvedValue({ message: { content: 'response' } })
};
```

**After:**

```typescript
const fixture = createChatFixture('model', 'prompt', 'response');
addCustomFixture(mock.mock, fixture);
const client = new Ollama({ host: mockUrl });
```

### Pattern 2: Replace vi.mock() Factory

**Before:**

```typescript
vi.mock('./client.js', () => ({
  getOllamaClient: vi.fn()
}));
```

**After:**

```typescript
const { mock, mockUrl } = useOllamaMock();
beforeAll(async () => await mock.beforeAll());
afterAll(async () => await mock.afterAll());
```

### Pattern 3: Replace Error Mocks

**Before:**

```typescript
vi.fn().mockRejectedValue(new Error('Failed'))
```

**After:**

```typescript
const fixture = createErrorFixture('POST', '/api/chat', 'Failed', 500);
addCustomFixture(mock.mock, fixture);
```

## Testing Strategy

1. **Unit Tests** - Use aimock for Ollama interaction
2. **Integration Tests** - Keep existing `test/integration/ollama.test.ts` (requires real Ollama)
3. **E2E Tests** - Use aimock for extension tests

## Benefits

✅ **More Realistic** - Tests real HTTP layer  
✅ **Better Coverage** - Tests actual API responses  
✅ **Faster** - No network latency  
✅ **Deterministic** - Same results every time  
✅ **Easier Maintenance** - Reusable fixtures  
✅ **Better Error Testing** - Realistic error responses  

## Rollback Plan

If issues arise:

1. Keep old mocks in separate branch
2. Migrate tests incrementally
3. Run full test suite after each migration
4. Revert specific tests if needed

## Timeline

- **Phase 1** (Week 1): provider.test.ts
- **Phase 2** (Week 2): completions.test.ts, openai-compat.test.ts
- **Phase 3** (Week 3): sidebar.test.ts, settings-webview.test.ts
- **Phase 4** (Week 4): Cleanup and documentation

## Resources

- **test/MIGRATION_GUIDE.md** - General patterns
- **test/PROVIDER_TEST_MIGRATION.md** - Specific examples
- **test/aimock-examples.test.ts** - Working code
- **test/AIMOCK_SETUP.md** - Complete reference

## Next Steps

1. ✅ Review migration guides
2. ✅ Run example tests: `npx vitest run test/aimock-examples.test.ts`
3. ⏭️ Start with provider.test.ts
4. ⏭️ Update one test at a time
5. ⏭️ Run full test suite: `npx vitest run`
6. ⏭️ Commit changes

## Questions?

Refer to:

- test/MIGRATION_GUIDE.md for patterns
- test/PROVIDER_TEST_MIGRATION.md for specific examples
- test/aimock-examples.test.ts for working code
