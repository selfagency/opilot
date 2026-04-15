import { http, HttpResponse } from 'msw';

const OLLAMA_BASE = 'http://localhost:11434';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sseStream(...payloads: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

/** Minimal model page HTML that satisfies `assertHtmlContentType` and the capability/description parsers. */
export function modelPageHtml(opts: {
  name: string;
  description?: string;
  capabilities?: Array<'Thinking' | 'Tools' | 'Vision' | 'Embedding'>;
}): string {
  const caps = opts.capabilities ?? [];
  return `<!DOCTYPE html>
<html>
<head>
  <title>${opts.name}</title>
  <meta name="description" content="${opts.description ?? `${opts.name} model`}" />
</head>
<body>
  <section aria-label="Capabilities">
    ${caps.map(c => `<span>${c}</span>`).join('\n    ')}
  </section>
</body>
</html>`;
}

/** Library listing HTML that satisfies the href-parsing logic in fetchLibraryModelNames. */
export function libraryPageHtml(models: string[]): string {
  const links = models.map(m => `<a href="/library/${m}">${m}</a>`).join('\n');
  return `<!DOCTYPE html><html><body>${links}</body></html>`;
}

// ---------------------------------------------------------------------------
// Default response shapes
// ---------------------------------------------------------------------------

export const DEFAULT_CHAT_CHUNK = JSON.stringify({
  id: 'chatcmpl-test',
  model: 'llama3.2',
  choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello!' } }],
});

export const DEFAULT_CHAT_RESPONSE = {
  id: 'chatcmpl-test',
  model: 'llama3.2',
  choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
};

export const DEFAULT_OLLAMA_API_TAGS = {
  models: [{ name: 'devstral:cloud' }, { name: 'llama4:cloud' }],
};

export const DEFAULT_LIBRARY_MODELS = ['llama3.2', 'mistral', 'phi4'];
export const DEFAULT_CLOUD_MODELS = ['devstral', 'llama4'];

// ---------------------------------------------------------------------------
// Handler groups
// ---------------------------------------------------------------------------

/** Handlers for the local Ollama OpenAI-compat API (http://localhost:11434) */
export const ollamaLocalHandlers = [
  // Streaming chat completions (default: one chunk + done)
  http.post(`${OLLAMA_BASE}/v1/chat/completions`, async ({ request }) => {
    const body = (await request.json()) as { stream?: boolean };
    if (body.stream === false) {
      return HttpResponse.json(DEFAULT_CHAT_RESPONSE);
    }
    return new HttpResponse(sseStream(DEFAULT_CHAT_CHUNK), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }),
];

/** Handlers for the ollama.com public API */
export const ollamaComHandlers = [
  // Main library listing page
  http.get('https://ollama.com/library', () => {
    return new HttpResponse(libraryPageHtml(DEFAULT_LIBRARY_MODELS), {
      headers: { 'Content-Type': 'text/html' },
    });
  }),

  // Model detail page (used by fetchModelPagePreview + fetchModelVariants)
  http.get('https://ollama.com/library/:model', ({ params }) => {
    const name = params['model'] as string;
    return new HttpResponse(modelPageHtml({ name }), {
      headers: { 'Content-Type': 'text/html' },
    });
  }),

  // Cloud search / model HTML listing
  http.get('https://ollama.com/search', () => {
    return new HttpResponse(libraryPageHtml(DEFAULT_CLOUD_MODELS), {
      headers: { 'Content-Type': 'text/html' },
    });
  }),

  // Cloud model tags (JSON used by CloudModelsProvider)
  http.get('https://ollama.com/api/tags', () => {
    return HttpResponse.json(DEFAULT_OLLAMA_API_TAGS);
  }),
];

/** All default handlers combined. Import this in `src/mocks/node.ts`. */
export const handlers = [...ollamaLocalHandlers, ...ollamaComHandlers];
