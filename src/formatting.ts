/**
 * Shared formatting utilities for extension and provider paths.
 */

import Saxophone, {
  type SaxophoneCData,
  type SaxophoneComment,
  type SaxophoneTag,
  type SaxophoneText,
} from 'saxophone';

export interface XmlStreamFilter {
  write(chunk: string): string;
  end(): string;
}

/**
 * Create a streaming XML filter that removes context tags as they are parsed.
 * Uses SAX parsing to handle incomplete tags across chunk boundaries.
 * Only complete non-context tags are passed through to the output.
 */
export function createXmlStreamFilter(): XmlStreamFilter {
  const contextTagNames = new Set([
    'environment_info',
    'workspace_info',
    'selection',
    'file_context',
    'user',
    'workspaces',
    'workspace',
    'session',
    'instructions',
    'context',
    'userPreferences',
    'userData',
    'profile',
    'history',
  ]);
  const parser = new Saxophone();
  let skipDepth = 0;
  let buffer = '';
  let flushedLength = 0; // Track how many bytes have been returned by write()

  parser.on('tagopen', (tag: SaxophoneTag) => {
    if (contextTagNames.has(tag.name)) {
      skipDepth++;
    } else if (skipDepth === 0) {
      // Reconstruct opening tag
      buffer += `<${tag.name}${tag.attrs ? ` ${tag.attrs}` : ''}${tag.isSelfClosing ? ' /' : ''}>`;
    }
  });

  parser.on('tagclose', (tag: SaxophoneTag) => {
    if (contextTagNames.has(tag.name)) {
      skipDepth--;
    } else if (skipDepth === 0) {
      buffer += `</${tag.name}>`;
    }
  });

  parser.on('text', (text: SaxophoneText) => {
    if (skipDepth === 0) {
      buffer += text.contents;
    }
  });

  parser.on('cdata', (cdata: SaxophoneCData) => {
    if (skipDepth === 0) {
      buffer += `<![CDATA[${cdata.contents}]]>`;
    }
  });

  parser.on('comment', (comment: SaxophoneComment) => {
    if (skipDepth === 0) {
      buffer += `<!--${comment.contents}-->`;
    }
  });

  parser.on('error', () => {
    // Ignore parsing errors - partial XML in streaming is expected
  });

  return {
    write(chunk: string): string {
      const prevLength = buffer.length;
      parser.write(chunk);
      const delta = buffer.substring(prevLength);
      flushedLength = buffer.length; // Track that we've returned content up to this point
      return delta;
    },
    end(): string {
      parser.end();
      // Only return content that hasn't been flushed yet
      return buffer.substring(flushedLength);
    },
  };
}

/**
 * Strip XML context tags from a complete response string.
 * Provided as a convenience for non-streaming scenarios.
 */
export function stripXmlContextTags(text: string): string {
  if (!text || !text.includes('<')) {
    return text;
  }

  const filter = createXmlStreamFilter();
  filter.write(text);
  return filter.end().trim();
}

/**
 * Format XML-like tags in LLM responses as markdown headings.
 * Example: <note>text</note> -> **Note**\ntext
 * Only applies to non-context tags where the tag is complete.
 */
export function formatXmlLikeResponseForDisplay(text: string): string {
  if (!text || !text.includes('<') || !text.includes('>')) {
    return text;
  }

  const blockTagRe = /<([a-zA-Z_][a-zA-Z0-9_.-]*)[^>]*>([\s\S]*?)<\/\1>/g;
  let replaced = false;
  const transformed = text.replace(blockTagRe, (_full, rawTag: string, rawContent: string) => {
    const tag = rawTag.replace(/[._-]+/g, ' ').trim();
    const title = tag.charAt(0).toUpperCase() + tag.slice(1);
    const content = String(rawContent).trim();
    replaced = true;
    return `\n\n**${title}**\n${content}\n\n`;
  });

  return replaced ? transformed.trim() : text;
}
