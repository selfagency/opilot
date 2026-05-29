/**
 * Shared formatting utilities for extension and provider paths.
 * Implementation delegated to @agentsy/core.
 */

import { splitLeadingXmlContextBlocks as _split } from '@agentsy/core/context';

export {
  dedupeXmlContextBlocksByTag,
  stripXmlContextTags
} from '@agentsy/core/context';
export {
  formatXmlLikeResponseForDisplay,
  sanitizeNonStreamingModelOutput
} from '@agentsy/core/formatting';
export {
  createXmlStreamFilter,
  type XmlStreamFilter
} from '@agentsy/core/xml-filter';

/**
 * Appends text to a markdown blockquote, adding `> ` prefix at line starts.
 * TODO: remove when @agentsy/core publishes this from /formatting.
 */
export function appendToBlockquote(text: string, atLineStart: boolean): string {
  if (!text) {
    return '';
  }

  return `${atLineStart ? '> ' : ''}${text.replaceAll('\n', '\n> ')}`;
}

/**
 * Return shape matching existing call sites that access `.content`.
 * The library uses `.remaining` — this wrapper preserves backward compat.
 */
export interface SplitLeadingXmlContextResult {
  content: string;
  contextBlocks: string[];
}

export function splitLeadingXmlContextBlocks(text: string): SplitLeadingXmlContextResult {
  const { remaining, contextBlocks } = _split(text);
  return { content: remaining, contextBlocks };
}
