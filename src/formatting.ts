/**
 * Shared formatting utilities for extension and provider paths.
 * Implementation delegated to focused @agentsy/* packages.
 */

import { splitLeadingXmlContextBlocks as _split } from '@agentsy/context';

export { dedupeXmlContextBlocksByTag, stripXmlContextTags } from '@agentsy/context';
export { formatXmlLikeResponseForDisplay, sanitizeNonStreamingModelOutput } from '@agentsy/formatting';
export { createXmlStreamFilter } from '@agentsy/xml-filter';
export type { XmlStreamFilter } from '@agentsy/xml-filter';

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
