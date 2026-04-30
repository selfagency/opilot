import type { Tool } from 'ollama';

export { buildXmlToolSystemPrompt, extractXmlToolCalls } from '@selfagency/llm-stream-parser/tool-calls';
export type { XmlToolCall, XmlToolInfo } from '@selfagency/llm-stream-parser/tool-calls';

export function normalizeToolParameters(inputSchema: unknown): Tool['function']['parameters'] {
  if (inputSchema && typeof inputSchema === 'object' && !Array.isArray(inputSchema)) {
    const schema = inputSchema as Record<string, unknown>;
    // Prevent LLMs from hallucinating extra parameters not defined in the schema.
    // Only inject when the schema is an object type and additionalProperties is not already set.
    if (schema.type === 'object' && schema.additionalProperties === undefined) {
      return { ...schema, additionalProperties: false } as Tool['function']['parameters'];
    }
    return inputSchema as Tool['function']['parameters'];
  }

  // Ollama validates tools against JSON Schema object shape.
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  } as Tool['function']['parameters'];
}

export function isToolsNotSupportedError(error: unknown): boolean {
  return (
    error instanceof Error && /does not support tools|error validating json schema|schemaerror/i.test(error.message)
  );
}
