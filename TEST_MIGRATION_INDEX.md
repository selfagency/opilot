# Aimock Test Migration - Complete Index

## 📚 Documentation Files

### Getting Started

- **test/QUICK_REFERENCE.md** ⭐ START HERE
  - Quick lookup card
  - Common patterns
  - Helper functions
  - Running tests

### Migration Guides

- **test/MIGRATION_GUIDE.md**
  - General migration patterns
  - Before/after examples
  - Common issues & solutions
  - Step-by-step process

- **test/PROVIDER_TEST_MIGRATION.md**
  - Specific provider.test.ts examples
  - Test conversion patterns
  - Migration checklist
  - Benefits overview

### Reference

- **test/AIMOCK_SETUP.md**
  - Complete aimock setup guide
  - Fixture format reference
  - All helper functions
  - Advanced usage

- **TEST_UPDATE_SUMMARY.md**
  - Overview of all tests to update
  - Priority levels
  - Migration timeline
  - Resources & next steps

## 🛠️ Implementation Files

### Test Utilities

- **test/utils/aimock-utils.ts**
  - `useOllamaMock()` - Vitest hook
  - `createChatFixture()` - Chat fixtures
  - `createEmbeddingsFixture()` - Embeddings fixtures
  - `createErrorFixture()` - Error fixtures
  - `addCustomFixture()` - Runtime fixture addition

### Fixtures

- **test/fixtures/ollama-chat.json** - Chat responses
- **test/fixtures/ollama-embeddings.json** - Embeddings responses
- **test/fixtures/ollama-errors.json** - Error scenarios

### Examples

- **test/aimock-examples.test.ts**
  - Working chat examples
  - Embeddings examples
  - Error handling examples
  - Custom fixtures examples

## 🎯 Tests to Update

### HIGH PRIORITY (Direct Ollama Interaction)

1. **src/provider.test.ts** (3007 lines)
   - See: test/PROVIDER_TEST_MIGRATION.md
   - Pattern: Replace vi.mock() + vi.fn()

2. **src/completions.test.ts**
   - Pattern: Replace vi.fn() for client.generate

3. **src/openai-compat.test.ts**
   - Pattern: Replace HTTP mocks with fixtures

### MEDIUM PRIORITY (Ollama Client Usage)

4. **src/sidebar.test.ts** (128k+ lines)
   - Pattern: Use fixtures for model listing

5. **src/settings-webview.test.ts**
   - Pattern: Use fixtures for model validation

### LOW PRIORITY (Minimal Ollama Interaction)

6. **src/extension.test.ts** (126k+ lines)
   - Optional migration

7. **src/modelfiles.test.ts**
   - Not needed (no Ollama calls)

## 📖 How to Use This Index

### For Quick Start

1. Read: test/QUICK_REFERENCE.md
2. Run: `npx vitest run test/aimock-examples.test.ts`
3. Start: src/provider.test.ts

### For Detailed Migration

1. Read: test/MIGRATION_GUIDE.md
2. Read: test/PROVIDER_TEST_MIGRATION.md
3. Reference: test/QUICK_REFERENCE.md
4. Implement: Update tests one by one

### For Complete Reference

1. Read: test/AIMOCK_SETUP.md
2. Reference: test/utils/aimock-utils.ts
3. Examples: test/aimock-examples.test.ts

## 🚀 Quick Start Commands

```bash
# Install aimock
npm install --save-dev @copilotkit/aimock

# Run example tests
npx vitest run test/aimock-examples.test.ts

# Run specific test file
npx vitest run src/provider.test.ts

# Run all tests
npx vitest run

# Watch mode
npx vitest watch src/provider.test.ts
```

## 📋 Migration Checklist

- [ ] Read test/QUICK_REFERENCE.md
- [ ] Run test/aimock-examples.test.ts
- [ ] Read test/MIGRATION_GUIDE.md
- [ ] Read test/PROVIDER_TEST_MIGRATION.md
- [ ] Update src/provider.test.ts
- [ ] Update src/completions.test.ts
- [ ] Update src/openai-compat.test.ts
- [ ] Update src/sidebar.test.ts
- [ ] Update src/settings-webview.test.ts
- [ ] Run full test suite
- [ ] Commit changes

## 🔑 Key Concepts

### Before (Manual Mocking)

```typescript
const mockClient = {
  chat: vi.fn().mockResolvedValue({ message: { content: 'response' } })
};
```

### After (Aimock)

```typescript
const { mock, mockUrl } = useOllamaMock();
const fixture = createChatFixture('model', 'prompt', 'response');
addCustomFixture(mock.mock, fixture);
const client = new Ollama({ host: mockUrl });
```

## ✨ Benefits

✅ Real HTTP layer testing  
✅ Better error coverage  
✅ Faster test execution  
✅ Deterministic results  
✅ Reusable fixtures  
✅ Easier maintenance  

## 📞 Need Help?

1. **Quick lookup** → test/QUICK_REFERENCE.md
2. **General patterns** → test/MIGRATION_GUIDE.md
3. **Specific examples** → test/PROVIDER_TEST_MIGRATION.md
4. **Complete reference** → test/AIMOCK_SETUP.md
5. **Working code** → test/aimock-examples.test.ts

## 📁 File Structure

```text
test/
├── fixtures/
│   ├── ollama-chat.json
│   ├── ollama-embeddings.json
│   └── ollama-errors.json
├── utils/
│   └── aimock-utils.ts
├── aimock-examples.test.ts
├── AIMOCK_SETUP.md
├── MIGRATION_GUIDE.md
├── PROVIDER_TEST_MIGRATION.md
├── QUICK_REFERENCE.md
└── PACKAGE_JSON_UPDATE.md

Root:
├── TEST_UPDATE_SUMMARY.md
├── AIMOCK_SETUP_SUMMARY.md
└── TEST_MIGRATION_INDEX.md (this file)
```

## 🎓 Learning Path

1. **Beginner** → test/QUICK_REFERENCE.md
2. **Intermediate** → test/MIGRATION_GUIDE.md
3. **Advanced** → test/AIMOCK_SETUP.md
4. **Hands-on** → test/aimock-examples.test.ts

## ✅ Status

- ✅ Aimock infrastructure created
- ✅ Test utilities created
- ✅ Example tests created
- ✅ Migration guides created
- ✅ Quick reference created
- ✅ Complete documentation ready

**Ready to start migrating tests!**
