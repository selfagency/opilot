---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core, @agentsy/providers
topic: Package overview & createPipeline
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# @agentsy/core + @agentsy/providers — Overview & createPipeline

## Architecture

Agentsy is a pnpm monorepo with a split-package architecture:

- **`@agentsy/core`** — Core stream-processing primitives (LLMStreamProcessor, pipeline transforms, SSE parser, recovery, retry, structured output, etc.)
- **`@agentsy/providers`** — Provider adaptation, normalizers, and `createPipeline` high-level API

## @agentsy/core main exports (`src/index.ts`)

```typescript
export * from './context/index.js';
export * from './formatting/index.js';
export * from './processor/index.js';
export * from './retry/index.js';
export * from './sse/index.js';
export * from './structured/index.js';
export * from './thinking/index.js';
export * from './tool-calls/index.js';
export * from './xml-filter/index.js';
// recovery is available via @agentsy/core/recovery subpath
```

Subpath exports: `@agentsy/core/context`, `@agentsy/core/processor`, `@agentsy/core/sse`, `@agentsy/core/structured`, `@agentsy/core/recovery`

---

## createPipeline (from `@agentsy/providers` — NOT `@agentsy/core`)

### Import

```typescript
import { createPipeline } from '@agentsy/providers/pipeline';
// or
import { createPipeline } from '@agentsy/providers';
```

### Signature

```typescript
export async function* createPipeline(
  source: AsyncIterable<string> | ReadableStream<string>,
  options: PipelineOptions
): AsyncGenerator<PipelineEvent>
```

Takes an SSE text stream (raw string chunks) and a provider, parses SSE frames, normalizes chunks per-provider, processes them through `LLMStreamProcessor`, and yields typed `PipelineEvent` objects.

### PipelineOptions

```typescript
export interface PipelineOptions extends ProcessorOptions {
  provider: NormalizerProvider;
  maxJsonDepth?: number;   // Max nesting depth for SSE JSON payloads (default: 64)
  maxJsonKeys?: number;    // Max keys in SSE JSON payloads (default: 10000)
}
```

### NormalizerProvider

```typescript
export type NormalizerProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'bedrock'
  | 'mistral'
  | 'ollama'
  | 'cohere'
  | 'hugging-face'
  | 'zai';
```

### PipelineEvent

```typescript
export interface PipelineEvent {
  content?: string;
  message?: string;
  provider: NormalizerProvider;
  thinking?: string;
  tool_call?: { name: string; parameters: JsonObject };
  type: 'delta' | 'thinking' | 'tool_call' | 'message_done' | 'error';
}
```

### Usage with Ollama

```typescript
import { createPipeline } from '@agentsy/providers';

const response = await fetch('http://localhost:11434/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'llama3.2',
    messages: [{ role: 'user', content: 'Hello' }],
    stream: true
  })
});

const pipeline = createPipeline(response.body!, {
  provider: 'ollama',
  parseThinkTags: true,
  knownTools: new Set(['get_weather'])
});

for await (const event of pipeline) {
  switch (event.type) {
    case 'delta':
      process.stdout.write(event.content!);
      break;
    case 'thinking':
      console.log('\n[Thinking]:', event.thinking);
      break;
    case 'tool_call':
      console.log('\n[Tool Call]:', event.tool_call!.name, event.tool_call!.parameters);
      break;
    case 'message_done':
      console.log('\n[Done]');
      break;
    case 'error':
      console.error('\n[Error]:', event.message);
      break;
  }
}
```

### How it works internally

1. Receives raw SSE text via `parseSSEStream` (from `@agentsy/core/sse`)
2. For each `SSEEvent`, parses `event.data` as JSON via `parseJson` (from `@agentsy/core/structured`)
3. Routes to the correct normalizer function based on `options.provider`
4. Normalizer returns a `StreamChunk`
5. Each normalized chunk is fed to `LLMStreamProcessor.process(chunk)`
6. The processor extracts thinking blocks, tool calls, and content
7. Yields typed `PipelineEvent` objects for each part
