import type { Message } from 'ollama';
import type { LanguageModelChatInformation } from 'vscode';

export function getAdvertisedContextLength(
  contextLength: number,
  supportsTools: boolean,
  nonToolModelMinPickerContextTokens: number,
): number {
  if (supportsTools) {
    return contextLength;
  }

  // For non-tool models, only use the picker minimum when the context length
  // is unknown or not set — never inflate a real known context length.
  if (contextLength && contextLength > 0) {
    return contextLength;
  }

  return nonToolModelMinPickerContextTokens;
}

export function getAdvertisedToolCalling(_nativeToolCalling: boolean): boolean {
  return true;
}

export function withModelPickerMetadata(
  info: LanguageModelChatInformation,
  nativeToolCalling: boolean,
  askPickerCategory: { label: string; order: number },
): LanguageModelChatInformation {
  const selectable = {
    ...info,
    isUserSelectable: true,
  } as LanguageModelChatInformation & {
    category?: {
      label: string;
      order: number;
    };
    isUserSelectable?: boolean;
  };

  if (nativeToolCalling) {
    return selectable;
  }

  return {
    ...selectable,
    category: askPickerCategory,
  } as LanguageModelChatInformation;
}

export function extractContextLengthFromInfo(modelinfo: Map<string, unknown> | Record<string, unknown>): unknown {
  if (modelinfo instanceof Map) {
    for (const [key, value] of modelinfo.entries()) {
      if (key === 'context_length' || key.endsWith('.context_length')) {
        return value;
      }
    }
  } else {
    for (const [key, value] of Object.entries(modelinfo)) {
      if (key === 'context_length' || key.endsWith('.context_length')) {
        return value;
      }
    }
  }
  return undefined;
}

export function extractContextLengthFromParameters(parameters: string | undefined): number {
  if (!parameters) return 0;
  const match = /^num_ctx\s+(\d+)/m.exec(parameters);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function parseModelContextLength(
  modelinfo: Map<string, unknown> | Record<string, unknown> | undefined,
  parameters: string | undefined,
): number {
  if (modelinfo) {
    const infoCtx = extractContextLengthFromInfo(modelinfo);
    if (typeof infoCtx === 'number' && infoCtx > 0) {
      return infoCtx;
    }
  }

  const parametersCtx = extractContextLengthFromParameters(parameters);
  return Math.max(parametersCtx, 0);
}

export function parseModelMaxOutputTokens(parameters: string | undefined, advertisedContextLength: number): number {
  if (parameters) {
    const predictMatch = /num_predict\s+(-?\d+)/m.exec(parameters);
    if (predictMatch) {
      const val = parseInt(predictMatch[1], 10);
      return val > 0 ? val : advertisedContextLength;
    }
  }
  return 4096;
}

export function buildReducedCloudRescueMessages(messages: Message[]): Message[] {
  const system = messages.find(m => m.role === 'system');
  const lastUser = [...messages].reverse().find(m => m.role === 'user');

  const reduced: Message[] = [];
  if (system) {
    reduced.push(system);
  }
  if (lastUser) {
    reduced.push(lastUser);
  }

  return reduced.length > 0 ? reduced : messages;
}

export function isToolModel(modelResponse: unknown): boolean {
  const response = modelResponse as Record<string, unknown>;
  const capabilities = response.capabilities;
  if (Array.isArray(capabilities) && capabilities.some(cap => String(cap).toLowerCase().includes('tool'))) {
    return true;
  }

  const template = response.template as string | undefined;
  return template ? template.includes('{{ .Tools }}') : false;
}

export function isThinkingModel(modelResponse: unknown): boolean {
  const response = modelResponse as Record<string, unknown>;
  const capabilities = response.capabilities;
  return Array.isArray(capabilities) && capabilities.some(cap => String(cap).toLowerCase().includes('thinking'));
}

export function isVisionModel(modelResponse: unknown): boolean {
  const response = modelResponse as Record<string, unknown>;
  const capabilities = response.capabilities;
  if (Array.isArray(capabilities) && capabilities.some(cap => String(cap).toLowerCase().includes('vision'))) {
    return true;
  }

  if (response.projector_info) {
    return true;
  }

  const details = response.details as Record<string, unknown> | undefined;
  const families = details?.families as string[] | undefined;
  return families ? families.includes('clip') || families.includes('vision') : false;
}
