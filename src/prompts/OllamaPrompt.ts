// High-level prompt assembler that composes parts produced by the smaller
// prompt-part factories above. This is a synchronous, minimal implementation
// used as a scaffolding until @vscode/prompt-tsx is adopted.

import { createContextBlocksPart } from './ContextBlocks';
import { createHistoryPart } from './HistoryTurn';
import { createUserPart } from './UserTurn';

export function assembleOllamaPrompt(parts: {
  system?: string;
  contextBlocks?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  user?: string;
}) {
  const out: { role: string; content: string }[] = [];
  if (parts.system) out.push({ role: 'system', content: parts.system });
  if (parts.contextBlocks) out.push({ role: 'system', content: parts.contextBlocks });
  if (parts.history) {
    for (const h of parts.history) out.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content });
  }
  if (parts.user) out.push({ role: 'user', content: parts.user });
  return out;
}
