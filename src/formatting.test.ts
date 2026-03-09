import { describe, expect, it } from 'vitest';
import {
  createXmlStreamFilter,
  dedupeXmlContextBlocksByTag,
  formatXmlLikeResponseForDisplay,
  sanitizeNonStreamingModelOutput,
  splitLeadingXmlContextBlocks,
  stripXmlContextTags,
} from './formatting.js';

describe('createXmlStreamFilter', () => {
  it('write() returns only new content per call with XML tags', () => {
    const filter = createXmlStreamFilter();
    // Trailing plain text after tags gets buffered by SAX
    const first = filter.write('<code>hello</code> ');
    expect(first).toBe('<code>hello</code>'); // Space buffered until next tag or end()
    const second = filter.write('<code>world</code>');
    expect(second).toBe(' <code>world</code>'); // Previous space plus new tag
  });

  it('end() returns only content not already returned by write()', () => {
    const filter = createXmlStreamFilter();
    filter.write('<code>hello</code> ');
    filter.write('<code>world</code>');
    // No buffered content remains after two complete writes
    expect(filter.end()).toBe('');
  });

  it('end() flushes plain text that could not be emitted mid-stream', () => {
    const filter = createXmlStreamFilter();
    // Plain text without tags gets buffered by SAX until end()
    const partial = filter.write('hello ');
    expect(partial).toBe(''); // SAX buffers plain text
    const final = filter.end();
    expect(final).toBe('hello '); // Flushed on end()
  });

  it('strips context tags across chunk boundaries', () => {
    const filter = createXmlStreamFilter();
    const a = filter.write('<environment_info>secret');
    const b = filter.write('</environment_info>');
    const c = filter.write('<code>actual content</code>');
    expect(a + b + c).toBe('<code>actual content</code>');
  });

  it('strips user_info tags across chunk boundaries', () => {
    const filter = createXmlStreamFilter();
    const a = filter.write('<user_info>private context');
    const b = filter.write('</user_info>');
    const c = filter.write(' visible answer');
    expect(a + b + c + filter.end()).toBe(' visible answer');
  });

  it('strips leaked conversation wrapper tags and nested content', () => {
    const filter = createXmlStreamFilter();
    const a = filter.write('<conversation-summary><analysis>hidden</analysis>');
    const b = filter.write('</conversation-summary>visible');
    expect(a + b + filter.end()).toBe('visible');
  });

  it('passes through non-context tags', () => {
    const filter = createXmlStreamFilter();
    const out = filter.write('<code>print("hi")</code>');
    expect(out + filter.end()).toContain('print("hi")');
  });

  it('prevents duplication when mixing tagged and plain text', () => {
    const filter = createXmlStreamFilter();
    const chunk1 = filter.write('<code>tagged</code>');
    const chunk2 = filter.write('plain');
    const finalChunk = filter.end();
    // The final string should not duplicate any content
    const fullOutput = chunk1 + chunk2 + finalChunk;
    expect(fullOutput).toBe('<code>tagged</code>plain');
    // Verify end() did not re-emit 'tagged' portion
    expect(finalChunk).toBe('plain');
  });
});

describe('stripXmlContextTags', () => {
  it('removes context tags from complete text', () => {
    const result = stripXmlContextTags('<environment_info>private</environment_info>public');
    expect(result).toBe('public');
  });

  it('removes user_info and workspace_info tags from complete text', () => {
    const result = stripXmlContextTags(
      '<user_info>private user</user_info><workspace_info>private workspace</workspace_info>public',
    );
    expect(result).toBe('public');
  });

  it('removes leaked wrapper blocks from complete text', () => {
    const result = stripXmlContextTags('<context><todoList>hidden</todoList></context>public');
    expect(result).toBe('public');
  });
});

describe('formatXmlLikeResponseForDisplay', () => {
  it('formats XML tags as markdown headings', () => {
    const result = formatXmlLikeResponseForDisplay('<note>important</note>');
    expect(result).toContain('**Note**');
    expect(result).toContain('important');
  });

  it('returns plain text unchanged when no tags', () => {
    expect(formatXmlLikeResponseForDisplay('plain text')).toBe('plain text');
  });

  it('handles nested tags by formatting outermost complete blocks and preserving inner markup', () => {
    const nested = '<section><note>inner</note></section>';
    const result = formatXmlLikeResponseForDisplay(nested);
    // The outermost block becomes a heading; inner tags remain intact in the content
    expect(result).toContain('**Section**');
    expect(result).toContain('<note>inner</note>');
  });

  it('leaves malformed or incomplete tags unchanged', () => {
    const malformed = '<note>unfinished';
    const result = formatXmlLikeResponseForDisplay(malformed);
    expect(result).toBe(malformed);
  });
});

describe('sanitizeNonStreamingModelOutput', () => {
  it('removes context tags and formats non-context tags', () => {
    const input =
      '<user_info>private context</user_info><workspace_info>workspace details</workspace_info><note>visible note</note>';
    const result = sanitizeNonStreamingModelOutput(input);

    expect(result).not.toContain('private context');
    expect(result).not.toContain('workspace details');
    expect(result).toContain('**Note**');
    expect(result).toContain('visible note');
  });
});

describe('createXmlStreamFilter — performance regression', () => {
  it('handles 1000-chunk mixed-content response without memory accumulation', () => {
    // Each chunk is a small content+tag mix, ensuring the aggregate input is large.
    // The assertion verifies correct output so any refactor that breaks the clear
    // strategy will be caught by incorrect output (not just a crash).
    const filter = createXmlStreamFilter();
    const CHUNKS = 1000;
    const chunks: string[] = [];

    for (let i = 0; i < CHUNKS; i++) {
      // Alternate between plain text, context tag (should be stripped), and visible tag
      const chunk =
        i % 3 === 0
          ? `word${i} `
          : i % 3 === 1
            ? `<environment_info>ctx${i}</environment_info>`
            : `<code>snippet${i}</code>`;
      chunks.push(filter.write(chunk));
    }
    chunks.push(filter.end());

    const full = chunks.join('');
    // Context tags must be stripped
    expect(full).not.toContain('<environment_info>');
    expect(full).not.toContain('</environment_info>');
    // Plain text must pass through
    expect(full).toContain('word0 ');
    expect(full).toContain('word999 ');
    // Visible tags must pass through
    expect(full).toContain('<code>snippet2</code>');
    expect(full).toContain('<code>snippet998</code>');
  });

  it('each write() call returns only the content from that call, not accumulated history', () => {
    // Regression: buffer must be cleared after write() so subsequent calls do
    // not re-emit previously returned content.
    const filter = createXmlStreamFilter();
    const result1 = filter.write('<code>first</code>');
    const result2 = filter.write('<code>second</code>');
    const result3 = filter.end();

    expect(result1).toBe('<code>first</code>');
    // result2 must not contain 'first'
    expect(result2).not.toContain('first');
    expect(result2).toContain('second');
    expect(result3).toBe('');
  });
});

describe('splitLeadingXmlContextBlocks', () => {
  it('extracts only leading XML context blocks', () => {
    const input = '<user_info>u1</user_info><workspace_info>w1</workspace_info>hello';
    const result = splitLeadingXmlContextBlocks(input);
    expect(result.contextBlocks).toEqual(['<user_info>u1</user_info>', '<workspace_info>w1</workspace_info>']);
    expect(result.content).toBe('hello');
  });

  it('does not elevate mid-message XML into context blocks', () => {
    const input = 'hello <user_info>not-context</user_info>';
    const result = splitLeadingXmlContextBlocks(input);
    expect(result.contextBlocks).toEqual([]);
    expect(result.content).toBe('hello <user_info>not-context</user_info>');
  });

  it('does not elevate unknown leading tags into context blocks', () => {
    const input = '<note>user content</note>hello';
    const result = splitLeadingXmlContextBlocks(input);
    expect(result.contextBlocks).toEqual([]);
    expect(result.content).toBe('<note>user content</note>hello');
  });

  it('does not elevate leading wrapper meta tags into context blocks', () => {
    const input = '<context><todoList>meta</todoList></context>hello';
    const result = splitLeadingXmlContextBlocks(input);
    expect(result.contextBlocks).toEqual([]);
    expect(result.content).toBe('<context><todoList>meta</todoList></context>hello');
  });
});

describe('dedupeXmlContextBlocksByTag', () => {
  it('keeps latest occurrence per tag and preserves output order', () => {
    const blocks = [
      '<environment_info>old-env</environment_info>',
      '<workspace_info>w1</workspace_info>',
      '<environment_info>new-env</environment_info>',
      '<user_info>u1</user_info>',
    ];

    const deduped = dedupeXmlContextBlocksByTag(blocks);
    expect(deduped).toEqual([
      '<workspace_info>w1</workspace_info>',
      '<environment_info>new-env</environment_info>',
      '<user_info>u1</user_info>',
    ]);
  });

  it('preserves relative order when a single entry contains multiple tags', () => {
    const blocks = ['<selection>s1</selection><workspace_info>w1</workspace_info>', '<selection>s2</selection>'];

    const deduped = dedupeXmlContextBlocksByTag(blocks);
    expect(deduped).toEqual(['<workspace_info>w1</workspace_info>', '<selection>s2</selection>']);
  });
});
