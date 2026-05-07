import type { Message } from 'ollama';
import {
  LanguageModelDataPart,
  LanguageModelTextPart,
  type LanguageModelChatRequestMessage,
  type ProvideLanguageModelChatResponseOptions,
} from 'vscode';

export function isImageMimeType(mimeType: string | undefined): boolean {
  return normalizeMimeType(mimeType).startsWith('image/');
}

export function isTextualMimeType(mimeType: string | undefined): boolean {
  const normalized = normalizeMimeType(mimeType);
  return (
    normalized.startsWith('text/') ||
    normalized === 'application/json' ||
    normalized.endsWith('+json') ||
    normalized === 'application/xml' ||
    normalized.endsWith('+xml')
  );
}

export function normalizeMimeType(mimeType: string | undefined): string {
  return (mimeType ?? '').split(';', 1)[0]?.trim().toLowerCase();
}

export function extractTextFromDataPart(part: LanguageModelDataPart): string | undefined {
  if (!isTextualMimeType(part.mimeType)) {
    return undefined;
  }

  try {
    return new TextDecoder('utf-8').decode(part.data);
  } catch {
    return undefined;
  }
}

export function extractTextFromUnknownInputPart(part: unknown): string {
  if (typeof part === 'string') {
    return part;
  }
  if (!part || typeof part !== 'object') {
    return '';
  }

  const maybePart = part as Record<string, unknown>;
  const directValues: unknown[] = [maybePart.value, maybePart.text, maybePart.prompt, maybePart.content];
  for (const value of directValues) {
    if (typeof value === 'string') {
      return value;
    }
  }

  const nestedValues: unknown[] = [maybePart.value, maybePart.text, maybePart.prompt, maybePart.content];
  for (const nested of nestedValues) {
    if (!nested || typeof nested !== 'object') {
      continue;
    }

    const nestedRecord = nested as Record<string, unknown>;
    if (typeof nestedRecord.value === 'string') {
      return nestedRecord.value;
    }
  }

  const toStringFn = (part as { toString?: () => string }).toString;
  if (typeof toStringFn !== 'function') {
    return '';
  }
  const converted = toStringFn.call(part);
  return converted && converted !== '[object Object]' ? converted : '';
}

export function summarizePart(part: unknown, index: number): Record<string, unknown> {
  const partRecord = (part && typeof part === 'object' ? (part as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  const ctorName =
    part && typeof part === 'object' ? (part as { constructor?: { name?: string } }).constructor?.name : typeof part;
  return {
    index,
    type: ctorName,
    keys: Object.keys(partRecord),
    mimeType: part instanceof LanguageModelDataPart ? part.mimeType : undefined,
    sample:
      extractTextFromUnknownInputPart(part)?.slice(0, 120) ||
      (part instanceof LanguageModelTextPart ? part.value.slice(0, 120) : ''),
  };
}

export function summarizeIncomingRequest(
  messages: readonly LanguageModelChatRequestMessage[],
  options: ProvideLanguageModelChatResponseOptions,
): Record<string, unknown> {
  const summarizedMessages = messages.map((message, index) => ({
    index,
    role: message.role,
    name: message.name,
    contentParts: message.content.map((part, partIndex) => summarizePart(part, partIndex)),
  }));

  return {
    messageCount: messages.length,
    messages: summarizedMessages,
    optionKeys: Object.keys((options as unknown as Record<string, unknown>) ?? {}),
    modelOptionKeys:
      options.modelOptions && typeof options.modelOptions === 'object'
        ? Object.keys(options.modelOptions as Record<string, unknown>)
        : [],
  };
}

export function extractMeaningfulUserText(messages: Message[]): string {
  const userMessages = messages
    .filter(m => m.role === 'user')
    .map(m => (typeof m.content === 'string' ? m.content : ''));
  const combined = userMessages.join('\n').trim();
  if (!combined) {
    return '';
  }

  const stripped = combined
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Ignore known scaffolding blocks that can appear without the actual ask
  const onlyScaffolding =
    /^(No user preferences|Session memory|I am working in a workspace|The user's current OS)/i.test(stripped);
  return onlyScaffolding ? '' : stripped;
}

export function extractPromptFromOptions(options: ProvideLanguageModelChatResponseOptions): string {
  const sources: unknown[] = [];
  if (options.modelOptions) {
    sources.push(options.modelOptions as unknown);
  }
  sources.push(options as unknown);

  for (const source of sources) {
    const prompt = deepFindPromptString(source, 0, new Set());
    if (prompt) {
      return prompt;
    }
  }

  return '';
}

export function deepFindPromptString(value: unknown, depth: number, seen: Set<unknown>): string {
  if (depth > 5 || value == null) {
    return '';
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    const isLikelyXmlScaffold = trimmed.startsWith('<') && trimmed.includes('>');
    const looksLikeNaturalPrompt = /\s/.test(trimmed) || /[?.!,:;]/.test(trimmed);
    return isLikelyXmlScaffold || !looksLikeNaturalPrompt ? '' : trimmed;
  }
  if (typeof value !== 'object' || seen.has(value)) {
    return '';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFindPromptString(item, depth + 1, seen);
      if (found) return found;
    }
    return '';
  }

  return deepFindInObject(value as Record<string, unknown>, depth, seen);
}

export function deepFindInObject(record: Record<string, unknown>, depth: number, seen: Set<unknown>): string {
  const priorityValues: unknown[] = [
    record.prompt,
    record.userPrompt,
    record.query,
    record.input,
    record.text,
    record.message,
  ];
  for (const value of priorityValues) {
    const found = deepFindPromptString(value, depth + 1, seen);
    if (found) return found;
  }

  const ignoredKeys = new Set(['toolMode', 'tools']);
  for (const [key, child] of Object.entries(record)) {
    if (!ignoredKeys.has(key)) {
      const found = deepFindPromptString(child, depth + 1, seen);
      if (found) return found;
    }
  }

  return '';
}
