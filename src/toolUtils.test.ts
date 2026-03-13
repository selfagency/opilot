import { describe, expect, it } from 'vitest';
import { buildXmlToolSystemPrompt, extractXmlToolCalls } from './toolUtils.js';

describe('buildXmlToolSystemPrompt', () => {
  it('returns empty string for empty tools array', () => {
    expect(buildXmlToolSystemPrompt([])).toBe('');
  });

  it('includes tool name and description', () => {
    const result = buildXmlToolSystemPrompt([{ name: 'search_files', description: 'Search for files' }]);
    expect(result).toContain('search_files');
    expect(result).toContain('Search for files');
  });

  it('renders parameter names with description hints', () => {
    const result = buildXmlToolSystemPrompt([
      {
        name: 'search_files',
        description: 'Search for files',
        inputSchema: {
          properties: {
            query: { description: 'The search query', type: 'string' },
            path: { type: 'string' },
          },
          required: ['query'],
        },
      },
    ]);
    expect(result).toContain('<query>The search query</query>');
    expect(result).toContain('<path>string (optional)</path>');
    expect(result).not.toContain('<query>The search query (optional)</query>');
  });

  it('handles multiple tools', () => {
    const result = buildXmlToolSystemPrompt([
      { name: 'tool_a', description: 'First tool' },
      { name: 'tool_b', description: 'Second tool' },
    ]);
    expect(result).toContain('tool_a');
    expect(result).toContain('tool_b');
  });

  it('handles tools with no inputSchema', () => {
    const result = buildXmlToolSystemPrompt([{ name: 'simple_tool' }]);
    expect(result).toContain('<simple_tool>');
    expect(result).toContain('</simple_tool>');
  });
});

describe('extractXmlToolCalls', () => {
  it('extracts a single tool call with parameters', () => {
    const text = '<search_files><query>foo bar</query><path>/src</path></search_files>';
    const result = extractXmlToolCalls(text, new Set(['search_files']));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('search_files');
    expect(result[0].parameters.query).toBe('foo bar');
    expect(result[0].parameters.path).toBe('/src');
  });

  it('extracts multiple sequential tool calls', () => {
    const text = '<read_file><path>a.ts</path></read_file><read_file><path>b.ts</path></read_file>';
    const result = extractXmlToolCalls(text, new Set(['read_file']));
    expect(result).toHaveLength(2);
    expect(result[0].parameters.path).toBe('a.ts');
    expect(result[1].parameters.path).toBe('b.ts');
  });

  it('ignores tags not in the known tools set', () => {
    const text = '<unknown_tool><x>y</x></unknown_tool><search_files><query>q</query></search_files>';
    const result = extractXmlToolCalls(text, new Set(['search_files']));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('search_files');
  });

  it('strips markdown XML fences before extracting', () => {
    const text = '```xml\n<search_files><query>hello</query></search_files>\n```';
    const result = extractXmlToolCalls(text, new Set(['search_files']));
    expect(result).toHaveLength(1);
    expect(result[0].parameters.query).toBe('hello');
  });

  it('strips leading prose before XML block', () => {
    const text = 'I will search for that.\n<search_files><query>test</query></search_files>';
    const result = extractXmlToolCalls(text, new Set(['search_files']));
    expect(result).toHaveLength(1);
    expect(result[0].parameters.query).toBe('test');
  });

  it('returns empty array when no XML tool calls present', () => {
    const result = extractXmlToolCalls('Just a plain text response.', new Set(['search_files']));
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty known tools set', () => {
    const result = extractXmlToolCalls('<something><x>y</x></something>', new Set());
    expect(result).toHaveLength(0);
  });

  it('handles parameters with multiline values', () => {
    const text = '<write_file><content>line 1\nline 2\nline 3</content></write_file>';
    const result = extractXmlToolCalls(text, new Set(['write_file']));
    expect(result).toHaveLength(1);
    expect(result[0].parameters.content).toBe('line 1\nline 2\nline 3');
  });

  it('handles tool calls with no parameters', () => {
    const text = '<list_tools></list_tools>';
    const result = extractXmlToolCalls(text, new Set(['list_tools']));
    expect(result).toHaveLength(1);
    expect(result[0].parameters).toEqual({});
  });

  it('trims whitespace from parameter values', () => {
    const text = '<search_files><query>  spaced  </query></search_files>';
    const result = extractXmlToolCalls(text, new Set(['search_files']));
    expect(result[0].parameters.query).toBe('spaced');
  });

  it('handles tool names with underscores and hyphens', () => {
    const text = '<vscode_codebase-search><q>x</q></vscode_codebase-search>';
    const result = extractXmlToolCalls(text, new Set(['vscode_codebase-search']));
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('vscode_codebase-search');
  });

  it('tolerates trailing whitespace in opening tag (space before >)', () => {
    const text = '<search_files ><query>spaced tag</query></search_files>';
    const result = extractXmlToolCalls(text, new Set(['search_files']));
    expect(result).toHaveLength(1);
    expect(result[0].parameters.query).toBe('spaced tag');
  });

  it('tolerates attribute on opening tag', () => {
    const text = '<search_files id="1"><query>attributed</query></search_files>';
    const result = extractXmlToolCalls(text, new Set(['search_files']));
    expect(result).toHaveLength(1);
    expect(result[0].parameters.query).toBe('attributed');
  });

  it('tolerates trailing whitespace in closing tag', () => {
    const text = '<search_files><query>close ws</query></search_files >';
    const result = extractXmlToolCalls(text, new Set(['search_files']));
    expect(result).toHaveLength(1);
    expect(result[0].parameters.query).toBe('close ws');
  });

  it('tolerates newline inside opening tag', () => {
    const text = '<search_files\n><query>newline tag</query></search_files>';
    const result = extractXmlToolCalls(text, new Set(['search_files']));
    expect(result).toHaveLength(1);
    expect(result[0].parameters.query).toBe('newline tag');
  });

  it('preserves left-to-right order across different tool names', () => {
    const text =
      '<read_file><path>first.ts</path></read_file>' +
      '<search_files><query>second</query></search_files>' +
      '<read_file><path>third.ts</path></read_file>';
    const result = extractXmlToolCalls(text, new Set(['read_file', 'search_files']));
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(expect.objectContaining({ name: 'read_file', parameters: { path: 'first.ts' } }));
    expect(result[1]).toEqual(expect.objectContaining({ name: 'search_files', parameters: { query: 'second' } }));
    expect(result[2]).toEqual(expect.objectContaining({ name: 'read_file', parameters: { path: 'third.ts' } }));
  });
});
