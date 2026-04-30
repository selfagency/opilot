// Placeholder scaffold for UserTurn.
// TODO: Replace with real @vscode/prompt-tsx TSX component when adopting prompt-tsx.

export function createUserPart(content: string) {
  return {
    priority: 800,
    type: 'user',
    content,
  };
}
