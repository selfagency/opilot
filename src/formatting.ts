import {
  dedupeXmlContextBlocksByTag as dedupeXmlContextBlocksByTagImpl,
  splitLeadingXmlContextBlocks as splitLeadingXmlContextBlocksImpl,
  stripXmlContextTags,
} from '@agentsy/context';
import {
  appendToBlockquote,
  formatXmlLikeResponseForDisplay,
  sanitizeNonStreamingModelOutput,
} from '@agentsy/formatting';
import { createXmlStreamFilter } from '@agentsy/xml-filter';

export interface SplitLeadingXmlContextResult {
  content: string;
  contextBlocks: string[];
}

export {
  appendToBlockquote,
  createXmlStreamFilter,
  formatXmlLikeResponseForDisplay,
  sanitizeNonStreamingModelOutput,
  stripXmlContextTags,
};

export function splitLeadingXmlContextBlocks(text: string): SplitLeadingXmlContextResult {
  const result = splitLeadingXmlContextBlocksImpl(text) as { contextBlocks: string[]; remaining: string };
  return { content: result.remaining, contextBlocks: result.contextBlocks };
}

export function dedupeXmlContextBlocksByTag(blocks: string[]): string[] {
  return dedupeXmlContextBlocksByTagImpl(blocks);
}
