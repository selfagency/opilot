---
source: Official GitHub Repository (selfagency/agentsy)
library: @agentsy/context
package: @agentsy/context
topic: conversation compression
fetched: 2026-06-04T10:45:00Z
official_docs: https://github.com/selfagency/agentsy/tree/main/packages/context
---

# @agentsy/context - Conversation Compression Documentation

The `@agentsy/context` package provides utilities for conversation history management, token budget enforcement, and output text compression.

## Primary Compression Functions

### `compressConversation<TMessage>`

Compresses a conversation history to fit within a specified token budget using various strategies (anchored-iterative, layered-pruning, or naive-dropping).

#### Signature

```typescript
function compressConversation<TMessage>(
  messages: readonly TMessage[],
  options: CompressionOptions<TMessage>
): CompressionResult<TMessage>
```

#### Parameters: `CompressionOptions<TMessage>`

- `maxTokens: number`: The maximum number of tokens allowed in the retained conversation.
- `preserveLast?: number`: (Optional) The number of recent messages to always keep, regardless of the budget.
- `estimateTokens?: (message: TMessage) => number`: (Optional) Custom function to estimate the token count of a message. Defaults to character-length based estimation (1 token per 4 characters).

#### Return Type: `CompressionResult<TMessage>`

- `compressed: boolean`: Indicates if any messages were dropped.
- `droppedCount: number`: The number of messages removed from the history.
- `estimatedTokens: number`: The total estimated token count of the retained messages.
- `messages: TMessage[]`: The array of retained messages.
- `metadata?: CompressionMetadata`: Detailed information about the compression process:
  - `coherenceScore: number`: A score representing the continuity of the conversation.
  - `driftDetected: boolean`: Whether a significant change in topic or context was detected.
  - `preservedAnchors: Array<{ importance: number; index: number; reason: string; type: string }>`: List of critical messages kept as "anchors".
  - `qualityScore: number`: A metric for the remaining information density.
  - `strategy: string`: The name of the algorithm used (e.g., `'anchored-iterative'`).

---

### `compressOutput`

Compresses assistant response text by removing filler words, redundant phrases, and normalizing whitespace while optionally preserving code, URLs, and paths.

#### Signature

```typescript
function compressOutput(
  response: string, 
  options: OutputCompressionOptions
): OutputCompressionResult
```

#### Parameters: `OutputCompressionOptions`

- `level: 'lite' | 'full' | 'ultra'`: The intensity of compression.
  - `'lite'`: Removes strong filler words (approx. 40-50% reduction).
  - `'full'`: Removes all filler words and redundant phrases (approx. 60-70% reduction).
  - `'ultra'`: Aggressive compression including abbreviations and clause reduction (approx. 75%+ reduction).
- `preserve?: Array<'code' | 'technical' | 'urls' | 'paths' | 'markdown' | 'errors'>`: Elements to keep exactly as-is. Defaults to everything in the list.
- `intensity?: number`: (Optional) Fine-grained control over the compression depth.

#### Return Type: `OutputCompressionResult`

- `compressed: string`: The resulting compressed text.
- `compressedTokens: number`: Estimated token count of the compressed version.
- `original: string`: The original input text.
- `originalTokens: number`: Estimated token count of the original text.
- `savingsRatio: number`: The ratio of tokens saved (0.0 to 1.0).
- `metadata?: { markers: Array<{ id: string; kind: 'preserved-code' | 'preserved-url' | 'preserved-inline-code' }> }`: Information about preserved elements.

---

### `createManualCompaction`

Creates a structured summary of messages for manual context management.

#### Signature

```typescript
function createManualCompaction(input: ManualCompactionInput): ManualCompactionResult
```

#### Return Type: `ManualCompactionResult`

- `summary: { focus: string; nextSteps: string[] }`: A high-level digest of the provided messages.

---

## Internal Utility Functions

- `scoreCoherence(messages: DriftMessageLike[]): CoherenceResult`: Evaluates conversation drift.
- `findAnchors(messages: readonly TMessage[], options?: AnchorFinderOptions): Anchor[]`: Identifies high-importance messages.
- `createDriftMonitor(options: DriftMonitorOptions): DriftMonitor`: Monitors conversation quality over time.
- `createTokenLedger(budget: TokenLedgerBudget): TokenLedger`: A simple stateful token tracker.
