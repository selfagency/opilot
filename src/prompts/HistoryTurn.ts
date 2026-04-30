// Placeholder scaffold for HistoryTurn.
// TODO: Replace with real @vscode/prompt-tsx TSX component when adopting prompt-tsx.

export function createHistoryPart(role: 'user' | 'assistant', content: string, index: number) {
  return {
    priority: 300 + index,
    type: role,
    content,
    index,
  };
}
