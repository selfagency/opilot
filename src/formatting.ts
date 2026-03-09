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

const XML_CONTEXT_TAG_RE = /<([a-zA-Z_][a-zA-Z0-9_.-]*)[^>]*>[\s\S]*?<\/\1>/gi;
const ELEVATED_CONTEXT_TAG_NAMES = new Set([
  // Strict allowlist for VS Code-injected context tags only.
  'environment_info',
  'user_info',
  'workspace_info',
  'selection',
  'file_context',
]);

const OUTPUT_SCRUB_TAG_NAMES = new Set([
  ...ELEVATED_CONTEXT_TAG_NAMES,
  // Non-VS-Code wrapper/meta tags we never want surfaced in model output.
  'user',
  'userRequest',
  'workspaces',
  'workspace',
  'session',
  'instructions',
  'context',
  'userPreferences',
  'userData',
  'profile',
  'history',
  'system',
  'systemPrompt',
  'chatHistory',
  'contextWindow',
  'injectedContext',
  'conversation-summary',
  'attachments',
  'attachment',
  'todoList',
  'reminderInstructions',
  'userMemory',
  'sessionMemory',
  'repository_memories',
]);

export interface SplitLeadingXmlContextResult {
  content: string;
  contextBlocks: string[];
}

/**
 * Split leading XML context blocks from a user message.
 * Only extracts XML blocks that start at index 0 (after trimStart), so
 * mid-message XML remains regular user text.
 */
export function splitLeadingXmlContextBlocks(text: string): SplitLeadingXmlContextResult {
  let remainingText = text;
  let hadLeadingContext = false;
  const contextBlocks: string[] = [];

  if (remainingText.trimStart().startsWith('<')) {
    remainingText = remainingText.trimStart();
    // eslint-disable-next-line no-constant-condition
    while (true) {
      XML_CONTEXT_TAG_RE.lastIndex = 0;
      const match = XML_CONTEXT_TAG_RE.exec(remainingText);
      if (!match || match.index !== 0) {
        break;
      }
      const tagName = match[1];
      if (!ELEVATED_CONTEXT_TAG_NAMES.has(tagName)) {
        break;
      }
      const matchedText = match[0];
      contextBlocks.push(matchedText.trim());
      remainingText = remainingText.slice(matchedText.length).trimStart();
      hadLeadingContext = true;
    }
  }

  return {
    content: hadLeadingContext ? remainingText : text.trim(),
    contextBlocks,
  };
}

/**
 * Deduplicate XML context blocks by tag name, keeping the most recent
 * occurrence per tag type while preserving overall order.
 */
export function dedupeXmlContextBlocksByTag(contextBlocks: readonly string[]): string[] {
  const latestByTag = new Map<string, string>();
  for (let i = contextBlocks.length - 1; i >= 0; i--) {
    const part = contextBlocks[i];
    XML_CONTEXT_TAG_RE.lastIndex = 0;
    const matches: RegExpExecArray[] = [];
    let match: RegExpExecArray | null;
    while ((match = XML_CONTEXT_TAG_RE.exec(part)) !== null) {
      matches.push(match);
    }

    // Iterate per-string matches from right to left so final output reversal
    // preserves left-to-right order of latest tag occurrences.
    for (let j = matches.length - 1; j >= 0; j--) {
      const currentMatch = matches[j];
      const tagName = currentMatch[1];
      if (!latestByTag.has(tagName)) {
        latestByTag.set(tagName, currentMatch[0].trim());
      }
    }
  }

  return [...latestByTag.values()].reverse();
}

/**
 * Create a streaming XML filter that removes context tags as they are parsed.
 * Uses SAX parsing to handle incomplete tags across chunk boundaries.
 * Only complete non-context tags are passed through to the output.
 *
 * Performance: `buffer` is cleared after every `write()` call so peak memory
 * stays proportional to the largest single output chunk, not the total response
 * length. The SAX parser's own internal state (partial-tag lookahead) is
 * separate from `buffer` and is unaffected by the clear.
 */
export function createXmlStreamFilter(): XmlStreamFilter {
  const parser = new Saxophone();
  let skipDepth = 0;
  let buffer = '';

  parser.on('tagopen', (tag: SaxophoneTag) => {
    if (OUTPUT_SCRUB_TAG_NAMES.has(tag.name)) {
      skipDepth++;
    } else if (skipDepth === 0) {
      // Reconstruct opening tag
      buffer += `<${tag.name}${tag.attrs ? ` ${tag.attrs}` : ''}${tag.isSelfClosing ? ' /' : ''}>`;
    }
  });

  parser.on('tagclose', (tag: SaxophoneTag) => {
    if (OUTPUT_SCRUB_TAG_NAMES.has(tag.name)) {
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
      // SAX events fire synchronously into `buffer` during parser.write().
      // Capturing and clearing `buffer` immediately releases the allocated
      // string instead of accumulating the entire response for the session lifetime.
      parser.write(chunk);
      const delta = buffer;
      buffer = '';
      return delta;
    },
    end(): string {
      // SAX flushes any internally-buffered trailing plain text on end().
      parser.end();
      return buffer;
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
  const cleaned = `${filter.write(text)}${filter.end()}`;
  return cleaned.trim();
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

/**
 * Sanitize complete (non-streaming) model output for display.
 * - Removes IDE-injected XML context tags (e.g. user/workspace metadata)
 * - Formats remaining XML-like content into markdown sections for readability
 */
export function sanitizeNonStreamingModelOutput(text: string): string {
  return formatXmlLikeResponseForDisplay(stripXmlContextTags(text));
}
