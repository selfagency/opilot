---
source: GitHub source code (https://github.com/selfagency/agentsy)
library: Agentsy
package: @agentsy/core
topic: Context compression utilities
fetched: 2026-05-28T20:00:00Z
official_docs: https://github.com/selfagency/agentsy
---

# Context Compression (`@agentsy/core/context`)

## Import

```typescript
import { compressMemoryFile, compressMemoryContent } from '@agentsy/core/context';
import type { MemoryCompressionOptions, MemoryCompressionResult } from '@agentsy/core/context';
```

---

## compressMemoryFile

Compresses a memory file on disk, preserving code blocks, inline code, and URLs.

```typescript
async function compressMemoryFile(
  filePath: string,
  options?: MemoryCompressionOptions
): Promise<MemoryCompressionResult>;
```

### MemoryCompressionOptions

```typescript
interface MemoryCompressionOptions {
  backup?: boolean;         // Create .original.md backup (default: true)
  level?: CompressionLevel; // 'full' (default)
}

type CompressionLevel = string; // defined in prose-compressor
```

### MemoryCompressionResult

```typescript
interface MemoryCompressionResult {
  backupPath?: string;     // Path to backup file if backup: true
  compressed: string;      // Compressed content
  compressedChars: number; // Character count after compression
  original: string;        // Original content
  originalChars: number;   // Character count before compression
  savingsRatio: number;    // (original - compressed) / original
}
```

### Security

Refuses to compress sensitive paths:

- Paths containing `.env`, `.netrc`, `id_rsa`, `authorized_keys`, `known_hosts`
- Files with extensions `.pem`, `.key`, `.p12`, `.pfx`, `.crt`, `.jks`
- Paths with segments `/.ssh/`, `/.aws/`, `/.gnupg/`, `/.kube/`, `/.docker/`
- Filenames containing `secret`, `credential`, `password`, `apikey`, `accesskey`, `token`, `privatekey`

### Usage

```typescript
import { compressMemoryFile } from '@agentsy/core/context';

const result = await compressMemoryFile('/path/to/memory.md', {
  backup: true,
  level: 'full'
});

console.log(`Compressed: ${result.originalChars} → ${result.compressedChars} chars`);
console.log(`Saved: ${(result.savingsRatio * 100).toFixed(1)}%`);
// Original backed up to /path/to/memory.md.original.md
```

---

## compressMemoryContent (exported via memory-compressor re-export)

```typescript
// compressMemoryContent is the internal compressContent function exposed via the
// context/compression/index.ts re-export. It compresses in-memory content
// preserving code blocks, inline code, and URLs.
```

## Other context exports (`@agentsy/core/context`)

- `context-segments.ts` — context segmentation utilities
- `dedupe-xml-context.ts` — DTD/XML context deduplication
- `split-leading-xml-context.ts` — Split leading XML context
- `strip-xml-context-tags.ts` — Strip XML context tags
