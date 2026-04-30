// Placeholder scaffold for ContextBlocks.
// TODO: Replace with real @vscode/prompt-tsx TSX component when adopting prompt-tsx.

export function createContextBlocksPart(blocks: string) {
  return {
    priority: 500,
    type: 'context',
    content: blocks,
  };
}
