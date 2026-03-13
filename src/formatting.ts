/**
 * Shared formatting utilities for extension and provider paths.
 * Implementation delegated to @selfagency/llm-stream-parser.
 */

import { splitLeadingXmlContextBlocks as _split } from '@selfagency/llm-stream-parser/context';

export { dedupeXmlContextBlocksByTag, stripXmlContextTags } from '@selfagency/llm-stream-parser/context';
export {
  formatXmlLikeResponseForDisplay,
  sanitizeNonStreamingModelOutput,
} from '@selfagency/llm-stream-parser/formatting';
export { createXmlStreamFilter } from '@selfagency/llm-stream-parser/xml-filter';
export type { XmlStreamFilter } from '@selfagency/llm-stream-parser/xml-filter';

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
