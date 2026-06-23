---
source: Web search (GitHub rohitg00/skillkit & selfagency/agentsy)
library: @agentsy/context
package: @agentsy/context
topic: CompressionOptions Interface
fetched: 2026-06-04T10:45:00Z
official_docs: https://github.com/selfagency/agentsy
---

# CompressionOptions Interface Definition

The `CompressionOptions` interface in `@agentsy/context` (and the related `@agentsy/memory` / `skillkit` ecosystem) defines how raw session observations are consolidated into structured learnings.

```typescript
/**
 * Compression options for context consolidation
 */
export interface CompressionOptions {
  /** 
   * Minimum number of observations required to trigger a compression cycle.
   * Default: 3
   */
  minObservations?: number;

  /** 
   * Maximum number of abstract learnings to generate per compression cycle.
   * Default: 10
   */
  maxLearnings?: number;

  /** 
   * Minimum importance score (range 1-10) required to preserve a learning.
   * Items below this threshold are decayed or discarded.
   * Default: 4
   */
  minImportance?: number;

  /** 
   * Whether to include low-relevance observations in the consolidation process.
   * Default: false
   */
  includeLowRelevance?: boolean;

  /** 
   * Custom tags to be appended to all generated learnings in this session.
   */
  additionalTags?: string[];

  /** 
   * Optional project name to scope the context consolidation.
   */
  projectName?: string;
}
```

## Usage Example

```typescript
import { CompressionOptions } from '@agentsy/context';

const options: CompressionOptions = {
  minObservations: 5,
  minImportance: 7,
  additionalTags: ['typescript', 'api-design']
};
```
