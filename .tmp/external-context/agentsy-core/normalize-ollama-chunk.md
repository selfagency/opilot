---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/providers
topic: normalizeOllamaChatChunk
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# normalizeOllamaChatChunk (`@agentsy/providers`)

## Import

```typescript
import { normalizeOllamaChatChunk, normalizeOllamaGenerateChunk } from '@agentsy/providers/normalizers';
```

---

## normalizeOllamaChatChunk

Normalizes an Ollama `/api/chat` streaming chunk into a canonical `NormalizerResult`.

```typescript
function normalizeOllamaChatChunk(raw: unknown): NormalizerResult | null;
```

Returns `null` if the chunk has no `message` field (use `normalizeOllamaGenerateChunk` for `/api/generate`).

**Never throws** — malformed input is silently ignored.

### Input format (Ollama `/api/chat` stream chunk)

```json
{
  "model": "llama3.2",
  "message": {
    "content": "Hello",
    "tool_calls": [
      {
        "function": {
          "name": "get_weather",
          "arguments": {"location": "NYC"}
        }
      }
    ]
  },
  "done": false,
  "prompt_eval_count": 10,
  "eval_count": 5
}
```

### What it extracts

| Field in raw chunk | Mapped to NormalizerResult.chunk |
|---|---|
| `message.content` | `content` (string) |
| `message.tool_calls[]` | `nativeToolCallDeltas` (serialized arguments as `argumentsDelta`) |
| `done` | `done` (boolean) |
| `prompt_eval_count` / `eval_count` | `usage.inputTokens` / `usage.outputTokens` (only on final chunk) |
| `done === true` | `finishReason: 'stop'` |

### Return type

```typescript
interface NormalizerResult {
  chunk: StreamChunk;
  rawEvent?: unknown;
}
```

Where `StreamChunk` is defined in `@agentsy/types` and contains:

- `content?: string`
- `done?: boolean`
- `nativeToolCallDeltas?: NativeToolCallDelta[]`
- `usage?: UsageInfo`
- `finishReason?: FinishReason`

### Usage

```typescript
import { normalizeOllamaChatChunk } from '@agentsy/providers/normalizers';

// Inside an SSE parser callback:
parser.on('event', (event) => {
  if (event.data && event.data !== '[DONE]') {
    const parsed = JSON.parse(event.data);
    const result = normalizeOllamaChatChunk(parsed);
    if (result) {
      processor.process(result.chunk);
    }
  }
});
```

---

## normalizeOllamaGenerateChunk

Normalizes an Ollama `/api/generate` streaming chunk (uses `response` field instead of `message.content`).

```typescript
function normalizeOllamaGenerateChunk(raw: unknown): NormalizerResult | null;
```

Returns `null` if the chunk has no string `response` field.
