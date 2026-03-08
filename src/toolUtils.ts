import type { Tool } from 'ollama';

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

export interface XmlToolCall {
  name: string;
  parameters: Record<string, string>;
}

interface XmlToolInfo {
  name: string;
  description?: string;
  inputSchema?: {
    properties?: Record<string, { description?: string; type?: string }>;
    required?: string[];
  };
}

function cleanXml(text: string): string {
  // Strip markdown XML fences (```xml...``` or ```...```)
  let cleaned = text.replace(/```xml\s*/gi, '').replace(/```\s*/g, '');
  // Strip leading non-tag chars and trailing non-tag chars (adapted from aispeck/llmxml _clean_xml)
  cleaned = cleaned.replace(/^[^<]*/, '').replace(/[^>]*$/, '');
  return cleaned;
}

export function buildXmlToolSystemPrompt(tools: readonly XmlToolInfo[]): string {
  if (!tools.length) return '';

  const toolDescriptions = tools.map(tool => {
    const schema = tool.inputSchema as XmlToolInfo['inputSchema'];
    const props = schema?.properties ?? {};
    const required = new Set(schema?.required ?? []);
    const paramLines = Object.entries(props).map(([name, s]) => {
      const hint = s.description ?? s.type ?? 'value';
      const optionalNote = required.has(name) ? '' : ' (optional)';
      return `  <${name}>${hint}${optionalNote}</${name}>`;
    });
    return [`// ${tool.name}: ${tool.description ?? ''}`, `<${tool.name}>`, ...paramLines, `</${tool.name}>`].join(
      '\n',
    );
  });

  // Concrete few-shot example using the first tool in the list.
  // Small models learn output format far better from a concrete example than from
  // declarative rules alone.
  const ex = tools[0];
  const exProps = Object.entries((ex.inputSchema as XmlToolInfo['inputSchema'])?.properties ?? {}).slice(0, 2);
  const exParamLines = exProps.map(([name]) => `  <${name}>example value</${name}>`);
  const exCall = [`<${ex.name}>`, ...exParamLines, `</${ex.name}>`].join('\n');

  return [
    '# Tool Use',
    '',
    'You have access to tools. When you need to call a tool, follow these rules exactly:',
    '1. Emit ONLY the raw XML block — no markdown fences (no ```xml), no prose before or after it.',
    '2. Call ONE tool per response. Wait for the result before calling another tool.',
    '3. When you have enough information to answer, respond in plain prose only. Do NOT include XML in your final answer.',
    '4. Never use JSON function-call syntax.',
    '',
    '## Available tools',
    '',
    toolDescriptions.join('\n\n'),
    '',
    `## Example (${ex.name})`,
    '',
    '// Correct — bare XML only:',
    exCall,
    '',
    `// After you receive [Tool result: ${ex.name}], answer in plain text.`,
  ].join('\n');
}

export function extractXmlToolCalls(text: string, knownTools: Set<string>): XmlToolCall[] {
  const cleaned = cleanXml(text);
  const results: XmlToolCall[] = [];

  if (knownTools.size === 0) {
    return results;
  }

  // Single-pass scan: one regex captures the tool name (group 1) and inner
  // content (group 2), then we filter by knownTools.  This keeps parsing cost
  // proportional to response size (not O(toolCount × responseLength)) and
  // preserves left-to-right call order even when multiple different tools appear.
  // Allow optional whitespace / attributes on the opening tag and optional
  // whitespace before > on the closing tag — models sometimes emit extra
  // spaces or attributes that would otherwise cause a silent parse failure.
  const toolPattern = /<([A-Za-z0-9_:-]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/g;

  for (const toolMatch of cleaned.matchAll(toolPattern)) {
    const toolName = toolMatch[1];
    if (!knownTools.has(toolName)) {
      continue;
    }
    const inner = toolMatch[2]; // capture group 2 = inner content
    const params: Record<string, string> = {};
    const paramPattern = /<([^/\s>]+)>([\s\S]*?)<\/\1>/g;
    for (const paramMatch of inner.matchAll(paramPattern)) {
      params[paramMatch[1]] = paramMatch[2].trim();
    }
    results.push({ name: toolName, parameters: params });
  }

  return results;
}

export default { normalizeToolParameters, isToolsNotSupportedError, buildXmlToolSystemPrompt, extractXmlToolCalls };
