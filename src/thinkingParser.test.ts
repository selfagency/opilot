// src/thinkingParser.test.ts
import { describe, it, expect } from 'vitest';
import { ThinkingParser } from './thinkingParser.js';

describe('ThinkingParser', () => {
  it('returns content unchanged when no think tags present', () => {
    const p = new ThinkingParser();
    const [thinking, content] = p.addContent('Hello world');
    expect(thinking).toBe('');
    expect(content).toBe('Hello world');
  });

  it('extracts thinking from <think>...</think>', () => {
    const p = new ThinkingParser();
    p.addContent('<think>');
    p.addContent('I am thinking');
    const [thinking, content] = p.addContent('</think>Answer');
    expect(thinking).toBe('I am thinking');
    expect(content).toBe('Answer');
  });

  it('buffers partial opening tag across chunks', () => {
    const p = new ThinkingParser();
    const [t1, c1] = p.addContent('<thi');
    expect(t1).toBe('');
    expect(c1).toBe(''); // buffered, waiting for more
    const [t2, c2] = p.addContent('nk>reasoning</think>done');
    expect(t2).toBe('reasoning');
    expect(c2).toBe('done');
  });

  it('buffers partial closing tag across chunks', () => {
    const p = new ThinkingParser();
    p.addContent('<think>thinking</');
    const [thinking, content] = p.addContent('think>response');
    expect(thinking).toBe('thinking');
    expect(content).toBe('response');
  });

  it('strips leading whitespace after opening tag', () => {
    const p = new ThinkingParser();
    p.addContent('<think>   \n');
    const [thinking] = p.addContent('actual thought</think>');
    expect(thinking).toBe('actual thought');
  });

  it('strips leading whitespace after closing tag', () => {
    const p = new ThinkingParser();
    p.addContent('<think>thought</think>   \n');
    const [, content] = p.addContent('response');
    expect(content).toBe('response');
  });

  it('handles content with no think block (thinking already done)', () => {
    const p = new ThinkingParser();
    const [t1, c1] = p.addContent('Plain response without thinking');
    expect(t1).toBe('');
    expect(c1).toBe('Plain response without thinking');
  });

  it('passes through content after thinking is complete', () => {
    const p = new ThinkingParser();
    p.addContent('<think>thought</think>');
    const [thinking, content] = p.addContent(' more content');
    expect(thinking).toBe('');
    expect(content).toBe(' more content');
  });
});
