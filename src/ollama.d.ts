/**
 * Module augmentation for the `ollama` npm package.
 *
 * The Ollama JS SDK declares `webSearch()` and `webFetch()` methods at runtime
 * on the internal `Ollama$1` base class, but they are NOT exposed in the
 * published TypeScript declarations (`dist/index.d.ts`). The response *types*
 * are exported (`WebSearchResponse`, `WebFetchResponse`) but the method
 * signatures are missing.
 *
 * This augmentation bridges that gap so callers in this codebase can invoke
 * `client.webSearch()` and `client.webFetch()` without `as unknown` casts.
 */
import type { WebFetchResponse, WebSearchResponse } from 'ollama';

declare module 'ollama' {
  interface Ollama {
    webFetch(url: string): Promise<WebFetchResponse>;
    webSearch(query: string, options?: { max_results?: number }): Promise<WebSearchResponse>;
  }
}
