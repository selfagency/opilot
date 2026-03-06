---
# ollama-models-vscode-4vps
title: Inline code completion provider with configurable model
status: todo
type: feature
priority: medium
created_at: 2026-03-06T05:50:22Z
updated_at: 2026-03-06T06:30:00Z
id: ollama-models-vscode-4vps
---

## Summary

The extension currently provides a chat participant (`@ollama`) and a language model provider for Copilot chat, but has no inline code completion support. This feature would add:

1. **`InlineCompletionItemProvider`** — registers with `vscode.languages.registerInlineCompletionItemProvider` for all file types, calls Ollama's `/api/generate` with the surrounding code context (prefix/suffix), and returns inline completions.
2. **Configuration setting** — `ollama.completionModel` (string) lets the user pick a different model for completions (e.g. a smaller/faster fill-in-the-middle model like `qwen2.5-coder:1.5b`) independently of the chat model.
3. **Enable/disable toggle** — `ollama.enableInlineCompletions` (boolean, default `true`) so users can turn it off without uninstalling.
4. **FIM (fill-in-the-middle) support** — use Ollama's `/api/generate` with the `suffix` field for models that support FIM (e.g. `deepseek-coder`, `qwen2.5-coder`, `starcoder2`); Ollama handles applying the model's FIM template automatically when `suffix` is non-empty. Models without a FIM template silently ignore the suffix and behave as regular completions.

---

## Assumptions

- **`client.generate()` is the correct API** — use the Ollama JS client's `generate()` method (not `chat()`), which maps to `/api/generate` and supports the `suffix` field for FIM.
- **`raw` is NOT set** — Ollama is allowed to apply the model's own template so FIM tokens are injected correctly for models that declare them.
- **`stream: false`** — inline completions work best as single-shot requests; streaming is not necessary and complicates the return path.
- **`completionModel` empty → silent null** — when the user hasn't configured a completion model, return `null` without any UI notification. This avoids random completions from an unexpected model. The VS Code inline completion status indicator will show nothing.
- **Config is re-read per call** — `provideInlineCompletionItems` reads the current config on every invocation (not cached in the constructor) so settings changes take effect immediately without restarting VS Code.
- **Context trimming** — prefix is capped at 2000 characters (≈50 lines), suffix at 500 characters (≈12 lines) before sending to Ollama. Constants are exported so tests can override them.
- **Cancellation check** — check `token.isCancellationRequested` immediately on entry and again after the `await generate()` returns. VS Code cancels outstanding requests when a new keystroke arrives, so this replaces explicit debouncing.
- **Non-fatal errors** — any exception from `client.generate()` (network error, 404 model not found, timeout) is caught, logged via `logChannel?.error`, and returns `null`. The user sees no error toast; completions simply don't appear.
- **`num_predict: 128`** — cap completion length at 128 tokens to keep responses fast.
- **`temperature: 0.1`** — low temperature for deterministic completions.
- **stop sequence `['\n\n']`** — stop at a blank line to avoid multi-paragraph completions.

---

## Settings spec (`package.json`)

Add two properties to the existing `ollama` configuration block (after `ollama.modelfilesPath`):

```json
"ollama.completionModel": {
  "type": "string",
  "default": "",
  "markdownDescription": "Model used for inline code completions. Leave empty to disable. Smaller, faster models work best (e.g. `qwen2.5-coder:1.5b`, `deepseek-coder:1.3b`)."
},
"ollama.enableInlineCompletions": {
  "type": "boolean",
  "default": true,
  "description": "Enable Ollama inline code completions."
}
```

---

## `src/completions.ts` API design

```typescript
export const MAX_COMPLETION_PREFIX_CHARS = 2000;
export const MAX_COMPLETION_SUFFIX_CHARS = 500;

export class OllamaInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  constructor(
    private client: Ollama,
    private logChannel?: DiagnosticsLogger,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | null> {
    if (token.isCancellationRequested) return null;

    const config = vscode.workspace.getConfiguration('ollama');
    if (!config.get<boolean>('enableInlineCompletions', true)) return null;

    const modelId = config.get<string>('completionModel')?.trim() ?? '';
    if (!modelId) return null;

    const fullText = document.getText();
    const offset = document.offsetAt(position);

    const rawPrefix = fullText.slice(0, offset);
    const rawSuffix = fullText.slice(offset);
    const prefix = rawPrefix.slice(-MAX_COMPLETION_PREFIX_CHARS);
    const suffix = rawSuffix.slice(0, MAX_COMPLETION_SUFFIX_CHARS);

    try {
      const response = await this.client.generate({
        model: modelId,
        prompt: prefix,
        suffix: suffix.length > 0 ? suffix : undefined,
        stream: false,
        options: { num_predict: 128, temperature: 0.1, stop: ['\n\n'] },
      });

      if (token.isCancellationRequested) return null;

      const text = response.response;
      if (!text?.trim()) return null;

      return [new vscode.InlineCompletionItem(text)];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logChannel?.error(`[Ollama] Inline completion failed: ${message}`);
      return null;
    }
  }
}
```

**Imports needed** (mirroring existing files):

```typescript
import type { Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
```

---

## `src/extension.ts` `activate()` changes

After `registerSidebar(...)` and `registerModelfileManager(...)`:

```typescript
import { OllamaInlineCompletionProvider } from './completions.js';

// in activate():
const completionProvider = new OllamaInlineCompletionProvider(client, diagnostics);
context.subscriptions.push(
  vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, completionProvider),
);
```

No changes needed to `deactivate()` — the subscription handles disposal automatically.

---

## Edge cases

| Scenario                                      | Expected behaviour                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `enableInlineCompletions = false`             | Return `null` immediately; no network call                                                  |
| `completionModel = ""`                        | Return `null` immediately; no network call                                                  |
| `completionModel` set but model not installed | `client.generate()` throws → caught → return `null`, log error                              |
| Cancellation before network call              | `token.isCancellationRequested` check at top → return `null`                                |
| Cancellation while awaiting `generate()`      | Ollama JS client does not abort mid-request; cancellation is checked after `await` resolves |
| Model returns empty string                    | Return `null` (falsy check on `text?.trim()`)                                               |
| Model returns only whitespace                 | Return `null` (whitespace `.trim()` = empty string)                                         |
| Document cursor at position 0                 | `prefix = ""`, `suffix = full document text` trimmed to 500 chars; `prompt = ""` (valid)    |
| Document cursor at end of file                | `suffix = ""` → `suffix` field omitted from generate request (prefix-only completion)       |
| File larger than 2500 chars                   | Prefix trimmed to last 2000 chars; suffix trimmed to first 500 chars                        |
| FIM model (qwen2.5-coder, deepseek-coder)     | Ollama applies FIM template automatically when `suffix` is passed                           |
| Non-FIM model (llama3, mistral)               | `suffix` is passed but Ollama ignores it; produces prefix-only completion                   |
| Network/timeout error                         | Caught → `logChannel.error` → return `null`                                                 |

---

## Test expectations (`src/completions.test.ts`)

Follow the same pattern as existing test files: `vi.resetModules()` in `beforeEach`, `vi.doMock('vscode', ...)` with a minimal vscode mock, mock `./client.js` with `vi.mock`.

### `OllamaInlineCompletionProvider` describe block

1. **`returns null when enableInlineCompletions is false`**
   - Setup: `getConfiguration('ollama').get('enableInlineCompletions')` → `false`
   - Assert: `client.generate` never called; result is `null`

2. **`returns null when completionModel is empty string`**
   - Setup: `getConfiguration('ollama').get('completionModel')` → `""`
   - Assert: `client.generate` never called; result is `null`

3. **`returns null when completionModel is whitespace`**
   - Setup: `getConfiguration('ollama').get('completionModel')` → `"  "`
   - Assert: result is `null`

4. **`calls client.generate with correct prefix and suffix`**
   - Setup: `completionModel = 'qwen2.5-coder:1.5b'`, `enableInlineCompletions = true`
   - Mock document: text = `"hello\nworld"`, cursor at offset 6 (start of `"world"`)
   - Assert: `client.generate` called with `{ model: 'qwen2.5-coder:1.5b', prompt: 'hello\n', suffix: 'world', stream: false, options: { num_predict: 128, ... } }`

5. **`returns InlineCompletionItem wrapping the response text`**
   - Setup: `client.generate` resolves with `{ response: ' = 42' }`
   - Assert: result is `[{ insertText: ' = 42' }]` (or check `instanceof vscode.InlineCompletionItem`)

6. **`returns null for empty response`**
   - Setup: `client.generate` resolves with `{ response: '' }`
   - Assert: result is `null`

7. **`returns null for whitespace-only response`**
   - Setup: `client.generate` resolves with `{ response: '   \n  ' }`
   - Assert: result is `null`

8. **`returns null when cancellation is requested on entry`**
   - Setup: `token.isCancellationRequested = true`
   - Assert: `client.generate` never called; result is `null`

9. **`returns null when cancellation is requested after generate resolves`**
   - Setup: cancellation token starts uncancelled; set `token.isCancellationRequested = true` inside a `client.generate` mock that resolves with `{ response: 'foo' }`
   - Assert: result is `null`

10. **`trims prefix to MAX_COMPLETION_PREFIX_CHARS`**
    - Setup: document prefix longer than `MAX_COMPLETION_PREFIX_CHARS`
    - Assert: `client.generate` called with `prompt` of length ≤ `MAX_COMPLETION_PREFIX_CHARS`

11. **`trims suffix to MAX_COMPLETION_SUFFIX_CHARS`**
    - Setup: document suffix longer than `MAX_COMPLETION_SUFFIX_CHARS`
    - Assert: `client.generate` called with `suffix` of length ≤ `MAX_COMPLETION_SUFFIX_CHARS`

12. **`omits suffix field when suffix is empty`**
    - Setup: cursor at end of document
    - Assert: `client.generate` called with `suffix: undefined` (not `suffix: ""`)

13. **`catches generate errors and returns null`**
    - Setup: `client.generate` rejects with `new Error('connection refused')`
    - Assert: result is `null`; `logChannel.error` called with a message containing `'connection refused'`

14. **`does not call logChannel.error when no logChannel provided`**
    - Setup: construct provider without `logChannel`; `client.generate` rejects
    - Assert: no throw; result is `null`

### `contributes.test.ts` additions

1. **`declares ollama.completionModel configuration property`**
   - Assert: `pkg.contributes.configuration.properties['ollama.completionModel']` exists with `type: 'string'`

2. **`declares ollama.enableInlineCompletions configuration property`**
   - Assert: `pkg.contributes.configuration.properties['ollama.enableInlineCompletions']` exists with `type: 'boolean'` and `default: true`

### `extension.test.ts` addition

1. **`registers inline completion provider during activation`**
   - Setup: add `languages: { registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })) }` to the vscode mock
   - Assert: `registerInlineCompletionItemProvider` called once with `{ pattern: '**' }` and an instance with `provideInlineCompletionItems`

---

## Todo

- [ ] Write failing tests in `src/completions.test.ts` (tests 1–14 above) — Red phase
- [ ] Write failing tests in `src/contributes.test.ts` (tests 15–16 above) — Red phase
- [ ] Write failing test in `src/extension.test.ts` (test 17 above) — Red phase
- [ ] Add `ollama.completionModel` property to `package.json` configuration contributes
- [ ] Add `ollama.enableInlineCompletions` property to `package.json` configuration contributes
- [ ] Create `src/completions.ts` with `OllamaInlineCompletionProvider` class and exported constants
- [ ] Add `vscode.InlineCompletionItem` and `vscode.InlineCompletionItemProvider` to `src/test/vscode.mock.ts`
- [ ] Update `src/extension.ts` `activate()` to import and register `OllamaInlineCompletionProvider`
- [ ] Add `languages.registerInlineCompletionItemProvider` mock to the `activate` test's vscode mock
- [ ] Run full test suite green
- [ ] Update README with new settings and usage note
- [ ] Commit and push
