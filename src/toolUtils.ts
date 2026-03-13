import type { Tool } from 'ollama';

export { buildXmlToolSystemPrompt, extractXmlToolCalls } from '@selfagency/llm-stream-parser/tool-calls';
export type { XmlToolCall, XmlToolInfo } from '@selfagency/llm-stream-parser/tool-calls';

export function normalizeToolParameters(inputSchema: unknown): Tool['function']['parameters'] {
  if (inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)) {
    return inputSchema as Tool['function']['parameters'];
  }

  // Ollama validates tools against JSON Schema object shape.
  return {
    type: 'object',
    properties: {},
  } as Tool['function']['parameters'];
}

export function isToolsNotSupportedError(error: unknown): boolean {
  return (
    error instanceof Error && /does not support tools|error validating json schema|schemaerror/i.test(error.message)
  );
}
