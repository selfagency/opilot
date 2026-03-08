/**
 * Live integration tests for Ollama server connectivity.
 *
 * Requirements:
 * - A running Ollama server on http://localhost:11434
 * - Non-tool local model: smollm:135m (smallest, no tools/thinking)
 * - Tool-capable local model: qwen3:0.6b (smallest with tools/thinking)
 * - Cloud model: any model with a `:cloud` or `-cloud` tag (optional — tests skip gracefully)
 *
 * Run with:  npx vitest run test/integration/ollama.test.ts
 */
import { Ollama } from 'ollama';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
const LOCAL_MODEL = process.env.OLLAMA_TEST_MODEL ?? 'smollm:135m';
const TOOL_MODEL = process.env.OLLAMA_TEST_TOOL_MODEL ?? 'qwen3:0.6b';

function isCloudTag(tag: string): boolean {
  return tag === 'cloud' || tag.endsWith('-cloud');
}

function supportsToolsFromShow(info: unknown): boolean {
  const response = info as Record<string, unknown>;
  const capabilities = response.capabilities;
  return Array.isArray(capabilities) && capabilities.some(cap => String(cap).toLowerCase().includes('tool'));
}

// ---------------------------------------------------------------------------
// Shared client
// ---------------------------------------------------------------------------

let client: Ollama;
let cloudModelName: string | undefined;
let cloudAuthValid = false;

beforeAll(async () => {
  client = new Ollama({ host: OLLAMA_HOST });

  // Ensure the server is reachable before running any tests.
  try {
    await client.list();
  } catch {
    throw new Error(`Cannot reach Ollama at ${OLLAMA_HOST}. Start the server before running integration tests.`);
  }

  // Detect a cloud model automatically so tests can run without manual config.
  const models = await client.list();
  const cloudEntry = models.models.find(m => {
    const tagPart = m.name.split(':')[1] ?? '';
    return isCloudTag(tagPart);
  });
  cloudModelName = cloudEntry?.name;

  // Validate cloud auth by trying a lightweight request with the API key.
  const cloudApiKey = process.env.OLLAMA_CLOUD_API_KEY;
  if (cloudModelName && cloudApiKey) {
    try {
      const cloudClient = new Ollama({
        host: OLLAMA_HOST,
        headers: { Authorization: `Bearer ${cloudApiKey}` },
      });
      await cloudClient.show({ model: cloudModelName });
      cloudAuthValid = true;
    } catch {
      console.log(`Cloud auth validation failed for ${cloudModelName} — cloud tests will be skipped.`);
    }
  }
});

// ---------------------------------------------------------------------------
// Connection & model listing
// ---------------------------------------------------------------------------

describe('Ollama server connection', () => {
  it('lists available models', async () => {
    const result = await client.list();
    expect(result.models).toBeDefined();
    expect(Array.isArray(result.models)).toBe(true);
    expect(result.models.length).toBeGreaterThan(0);
  });

  it('shows model info for the local test model', async () => {
    const info = await client.show({ model: LOCAL_MODEL });
    expect(info).toBeDefined();
    expect(info.details).toBeDefined();
    expect(info.details.family).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Local model — start / stop
// ---------------------------------------------------------------------------

describe('Local model start and stop', () => {
  it('starts a local model and verifies it is running', async () => {
    // Start the model using the same pattern as sidebar.ts startModel()
    await client.generate({
      model: LOCAL_MODEL,
      prompt: '',
      stream: false,
      keep_alive: '10m',
    });

    // Verify the model appears in `ps`
    const ps = await client.ps();
    const running = ps.models.find(m => m.name.includes(LOCAL_MODEL.split(':')[0]));
    expect(running).toBeDefined();
    expect(running!.name).toContain(LOCAL_MODEL.split(':')[0]);
  }, 120_000);

  it('stops a local model and verifies it is no longer running', async () => {
    // Ensure the model is running first
    await client.generate({
      model: LOCAL_MODEL,
      prompt: '',
      stream: false,
      keep_alive: '10m',
    });

    // Stop the model using keep_alive: 0 (same pattern as sidebar.ts stopModel())
    await client.generate({
      model: LOCAL_MODEL,
      prompt: '',
      stream: false,
      keep_alive: 0,
    });

    // Ollama unloads asynchronously — send a second keep_alive:0 to be sure,
    // then poll ps until the model disappears
    await client.generate({
      model: LOCAL_MODEL,
      prompt: '',
      stream: false,
      keep_alive: 0,
    });

    const modelBase = LOCAL_MODEL.split(':')[0];
    let unloaded = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      const ps = await client.ps();
      const running = ps.models.find(m => m.name.includes(modelBase));
      if (!running) {
        unloaded = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    expect(unloaded).toBe(true);
  }, 120_000);

  it('restarts a local model after stopping it', async () => {
    // Stop first
    await client.generate({
      model: LOCAL_MODEL,
      prompt: '',
      stream: false,
      keep_alive: 0,
    });

    // Start again
    await client.generate({
      model: LOCAL_MODEL,
      prompt: '',
      stream: false,
      keep_alive: '10m',
    });

    const ps = await client.ps();
    const running = ps.models.find(m => m.name.includes(LOCAL_MODEL.split(':')[0]));
    expect(running).toBeDefined();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Local model — chat
// ---------------------------------------------------------------------------

describe('Local model chat', () => {
  it('generates a non-streaming response', async () => {
    const response = await client.chat({
      model: LOCAL_MODEL,
      messages: [{ role: 'user', content: 'Reply with only the word "hello".' }],
      stream: false,
      options: { num_predict: 20 },
    });

    expect(response.message).toBeDefined();
    expect(response.message.role).toBe('assistant');
    expect(response.message.content.length).toBeGreaterThan(0);
  }, 120_000);

  it('generates a streaming response', async () => {
    const chunks: string[] = [];
    const stream = await client.chat({
      model: LOCAL_MODEL,
      messages: [{ role: 'user', content: 'Reply with only the word "yes".' }],
      stream: true,
      options: { num_predict: 20 },
    });

    for await (const chunk of stream) {
      if (chunk.message?.content) {
        chunks.push(chunk.message.content);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const fullText = chunks.join('');
    expect(fullText.length).toBeGreaterThan(0);
  }, 120_000);

  it('handles multi-turn conversation', async () => {
    const response = await client.chat({
      model: LOCAL_MODEL,
      messages: [
        { role: 'user', content: 'Remember the number 42.' },
        { role: 'assistant', content: 'I will remember the number 42.' },
        { role: 'user', content: 'What number did I ask you to remember? Reply with just the number.' },
      ],
      stream: false,
      options: { num_predict: 20 },
    });

    expect(response.message.content).toBeDefined();
    expect(response.message.content.length).toBeGreaterThan(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Local model — generate (completion)
// ---------------------------------------------------------------------------

describe('Local model generate', () => {
  it('generates a completion', async () => {
    const response = await client.generate({
      model: LOCAL_MODEL,
      prompt: 'The capital of France is',
      stream: false,
      options: { num_predict: 20 },
    });

    expect(response.response).toBeDefined();
    expect(response.response.length).toBeGreaterThan(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Local model — embeddings
// ---------------------------------------------------------------------------

describe('Local model embeddings', () => {
  it('produces an embedding vector', async () => {
    const response = await client.embed({
      model: LOCAL_MODEL,
      input: 'Hello, world!',
    });

    expect(response.embeddings).toBeDefined();
    expect(Array.isArray(response.embeddings)).toBe(true);
    expect(response.embeddings.length).toBeGreaterThan(0);
    expect(response.embeddings[0].length).toBeGreaterThan(0);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Tool-capable model checks
// ---------------------------------------------------------------------------

describe('Tool-capable model', () => {
  it('is available and reports tool capability', async () => {
    const info = await client.show({ model: TOOL_MODEL });
    expect(info).toBeDefined();
    expect(supportsToolsFromShow(info)).toBe(true);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Model lifecycle — pull, create, delete
// ---------------------------------------------------------------------------

describe('Model lifecycle', () => {
  const CUSTOM_MODEL_NAME = 'integration-test-custom';

  afterAll(async () => {
    // Cleanup: delete the custom model if it exists
    try {
      await client.delete({ model: CUSTOM_MODEL_NAME });
    } catch {
      // Ignore if it doesn't exist
    }
  });

  it('creates a model from a base model', async () => {
    const stream = await client.create({
      model: CUSTOM_MODEL_NAME,
      from: LOCAL_MODEL,
      system: 'You are a helpful test assistant.',
      stream: true,
    });

    const statuses: string[] = [];
    for await (const chunk of stream) {
      if (chunk.status) {
        statuses.push(chunk.status);
      }
    }

    expect(statuses.length).toBeGreaterThan(0);

    // Verify the model was created
    const info = await client.show({ model: CUSTOM_MODEL_NAME });
    expect(info).toBeDefined();
  }, 120_000);

  it('deletes a model', async () => {
    // Create first so we have something to delete
    await client.create({
      model: `${CUSTOM_MODEL_NAME}-del`,
      from: LOCAL_MODEL,
      stream: false,
    });

    await client.delete({ model: `${CUSTOM_MODEL_NAME}-del` });

    // Verify deletion
    const list = await client.list();
    const found = list.models.find(m => m.name.startsWith(`${CUSTOM_MODEL_NAME}-del`));
    expect(found).toBeUndefined();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Cloud model tests (skipped when no cloud model or API key is available)
// ---------------------------------------------------------------------------

const CLOUD_API_KEY = process.env.OLLAMA_CLOUD_API_KEY;

function skipCloud(): boolean {
  if (!cloudModelName) {
    console.log('Skipping cloud test — no cloud model found.');
    return true;
  }
  if (!CLOUD_API_KEY) {
    console.log('Skipping cloud test — OLLAMA_CLOUD_API_KEY not set.');
    return true;
  }
  if (!cloudAuthValid) {
    console.log('Skipping cloud test — cloud auth validation failed.');
    return true;
  }
  return false;
}

function getCloudClient(): Ollama {
  return new Ollama({
    host: OLLAMA_HOST,
    headers: { Authorization: `Bearer ${CLOUD_API_KEY}` },
  });
}

describe('Cloud model chat', () => {
  it('generates a non-streaming response from a cloud model', async () => {
    if (skipCloud()) return;

    const response = await getCloudClient().chat({
      model: cloudModelName!,
      messages: [{ role: 'user', content: 'Reply with only the word "hello".' }],
      stream: false,
    });

    expect(response.message).toBeDefined();
    expect(response.message.role).toBe('assistant');
    expect(response.message.content.length).toBeGreaterThan(0);
  }, 120_000);

  it('generates a streaming response from a cloud model', async () => {
    if (skipCloud()) return;

    const chunks: string[] = [];
    const stream = await getCloudClient().chat({
      model: cloudModelName!,
      messages: [{ role: 'user', content: 'Reply with only the word "yes".' }],
      stream: true,
    });

    for await (const chunk of stream) {
      if (chunk.message?.content) {
        chunks.push(chunk.message.content);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Cloud model — generate (completion)
// ---------------------------------------------------------------------------

describe('Cloud model generate', () => {
  it('generates a completion from a cloud model', async () => {
    if (skipCloud()) return;

    const response = await getCloudClient().generate({
      model: cloudModelName!,
      prompt: 'The capital of France is',
      stream: false,
    });

    expect(response.response).toBeDefined();
    expect(response.response.length).toBeGreaterThan(0);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Cloud model — start / stop
// ---------------------------------------------------------------------------

describe('Cloud model start and stop', () => {
  // Cloud models are proxied remotely and do not appear in `ollama ps`.
  // These tests verify the start/stop API calls succeed without error.

  it('starts a cloud model without error', async () => {
    if (skipCloud()) return;

    const response = await getCloudClient().generate({
      model: cloudModelName!,
      prompt: '',
      stream: false,
      keep_alive: '10m',
    });

    expect(response).toBeDefined();
  }, 120_000);

  it('stops a cloud model without error', async () => {
    if (skipCloud()) return;

    const response = await getCloudClient().generate({
      model: cloudModelName!,
      prompt: '',
      stream: false,
      keep_alive: 0,
    });

    expect(response).toBeDefined();
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Cloud model detection logic (unit-style, no server needed)
// ---------------------------------------------------------------------------

describe('Cloud model detection', () => {
  it('identifies :cloud tag as cloud', () => {
    expect(isCloudTag('cloud')).toBe(true);
  });

  it('identifies -cloud suffix as cloud', () => {
    expect(isCloudTag('latest-cloud')).toBe(true);
    expect(isCloudTag('thinking-cloud')).toBe(true);
  });

  it('rejects non-cloud tags', () => {
    expect(isCloudTag('latest')).toBe(false);
    expect(isCloudTag('3b')).toBe(false);
    expect(isCloudTag('')).toBe(false);
    expect(isCloudTag('cloudinary')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parseability of XML context extraction regex
// (Validates the generalized regex used in provider.ts and extension.ts)
// ---------------------------------------------------------------------------

describe('XML context tag extraction', () => {
  const XML_CONTEXT_TAG_RE = /<([a-zA-Z_][a-zA-Z0-9_.-]*)[^>]*>[\s\S]*?<\/\1>/gi;

  function extractLeadingContextBlocks(text: string): { blocks: string[]; remaining: string } {
    const blocks: string[] = [];
    let remaining = text.trimStart();

    if (!remaining.startsWith('<')) return { blocks, remaining: text };

    XML_CONTEXT_TAG_RE.lastIndex = 0;
    while (true) {
      const match = XML_CONTEXT_TAG_RE.exec(remaining);
      if (!match || match.index !== 0) break;
      blocks.push(match[0].trim());
      remaining = remaining.slice(match[0].length).trimStart();
      XML_CONTEXT_TAG_RE.lastIndex = 0;
    }

    return { blocks, remaining };
  }

  it('extracts known VS Code context tags', () => {
    const input = `<environment_info>macOS</environment_info>
<workspace_info>project</workspace_info>
Hello, how are you?`;

    const { blocks, remaining } = extractLeadingContextBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain('environment_info');
    expect(blocks[1]).toContain('workspace_info');
    expect(remaining).toBe('Hello, how are you?');
  });

  it('extracts arbitrary tags like instructions, attachment, skills', () => {
    const input = `<instructions>Follow these rules</instructions>
<attachment filePath="/some/path">content here</attachment>
<skills>skill data</skills>
What should I do?`;

    const { blocks, remaining } = extractLeadingContextBlocks(input);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toContain('instructions');
    expect(blocks[1]).toContain('attachment');
    expect(blocks[2]).toContain('skills');
    expect(remaining).toBe('What should I do?');
  });

  it('stops extracting at non-XML content', () => {
    const input = `<environment_info>macOS</environment_info>
This is user text with <b>HTML</b> inside.`;

    const { blocks, remaining } = extractLeadingContextBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(remaining).toContain('This is user text');
  });

  it('does not extract inline tags that are not at the start', () => {
    const input = 'Hello <b>world</b>';
    const { blocks, remaining } = extractLeadingContextBlocks(input);
    expect(blocks).toHaveLength(0);
    expect(remaining).toBe('Hello <b>world</b>');
  });

  it('deduplicates by tag name keeping the latest occurrence', () => {
    const blocks = ['<env>old data</env>', '<workspace>info</workspace>', '<env>new data</env>'];

    // Simulate the dedup from provider.ts / extension.ts
    const latestByTag = new Map<string, string>();
    for (let i = blocks.length - 1; i >= 0; i--) {
      XML_CONTEXT_TAG_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = XML_CONTEXT_TAG_RE.exec(blocks[i])) !== null) {
        const tagName = match[1];
        if (!latestByTag.has(tagName)) {
          latestByTag.set(tagName, match[0]);
        }
      }
    }

    const deduped = [...latestByTag.values()].reverse();
    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toContain('info'); // workspace
    expect(deduped[1]).toContain('new data'); // latest env
  });
});
