---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core
topic: ThinkingParser & createThinkingFilter
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# ThinkingParser (`@agentsy/core`)

## Import

```typescript
import { ThinkingParser } from '@agentsy/core';
// or
import { ThinkingParser } from '@agentsy/core/thinking';
```

## Class: ThinkingParser

A streaming parser that extracts `<think>…</think>` blocks (or custom tag pairs) from LLM output chunk-by-chunk.

### Constructor

```typescript
class ThinkingParser {
  constructor(options?: ThinkingParserOptions);
}

interface ThinkingParserOptions {
  closingTag?: string;  // Default: '</think>'
  openingTag?: string;  // Default: '<think>'
}
```

### Static factory

```typescript
// Returns a ThinkingParser pre-configured for a known model ID.
// Falls back to default <think>/</think> tags for unrecognised models.
static forModel(
  modelId: string,
  thinkingTagMap?: Map<string, ThinkingTagPair>
): ThinkingParser;
```

Built-in model→tag mappings:

| Model IDs | Opening Tag | Closing Tag |
|-----------|-------------|-------------|
| deepseek, qwen, llama, mistral | `<think>` | `</think>` |
| granite | `<\|thinking\|>` | `</\|thinking\|>` |

### Methods

```typescript
// Process a streaming text chunk. Returns [thinkingContent, regularContent] deltas.
addContent(chunk: string): [thinkingContent: string, regularContent: string]

// Flush any partially-buffered content. Call after last addContent().
flush(): [thinkingContent: string, regularContent: string]

// Check if parser is in incomplete state (open tag without close)
isIncomplete(): boolean

// Reset parser state
reset(): void
```

### Properties

```typescript
readonly openingTag: string;
readonly closingTag: string;
```

### Usage

```typescript
const parser = new ThinkingParser();
// Or for Granite model:
const parser = ThinkingParser.forModel('granite');
// Or with custom tags:
const parser = new ThinkingParser({
  openingTag: '<reasoning>',
  closingTag: '</reasoning>'
});

for await (const chunk of stream) {
  const [thinking, content] = parser.addContent(chunk);
  if (thinking) console.log('Thinking:', thinking);
  if (content) process.stdout.write(content);
}

// At end of stream
const [finalThinking, finalContent] = parser.flush();
```

## Note: No separate `createThinkingFilter` in thinking module

The `createThinkingFilter` function mentioned in the user question is actually a **pipeline transform** in `@agentsy/core/processor/pipeline/transform.ts` (see pipeline-transforms.md). It uses the `OutputPart` type system to filter out parts where `part.type === 'thinking'`.
