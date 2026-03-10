import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// node:fs/promises mock — set up before importing the module under test
// ---------------------------------------------------------------------------

const { mockReadFile, mockWriteFile, mockMkdir } = vi.hoisted(() => ({
  mockReadFile: vi.fn<(path: string, encoding: string) => Promise<string>>(),
  mockWriteFile: vi.fn<(path: string, data: string, encoding: string) => Promise<void>>(),
  mockMkdir: vi.fn<(path: string, opts: { recursive: boolean }) => Promise<void>>(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}));

// ---------------------------------------------------------------------------
// Module under test (imported after the mock is in place)
// ---------------------------------------------------------------------------

import {
  getModelOptionsForModel,
  getModelSettingsFilePath,
  loadModelSettings,
  saveModelSettings,
  type ModelSettingsStore,
} from './modelSettings.js';

describe('modelSettings persistence', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  async function createStorageUri(): Promise<{ fsPath: string }> {
    const dir = await mkdtemp(join(tmpdir(), 'opilot-model-settings-'));
    tempDirs.push(dir);
    return { fsPath: dir };
  }

  it('returns empty store when settings file does not exist', async () => {
    const storageUri = await createStorageUri();
    const loaded = await loadModelSettings(storageUri);
    expect(loaded).toEqual({});
  });

  it('builds model settings file path under global storage', async () => {
    const storageUri = await createStorageUri();
    const filePath = getModelSettingsFilePath(storageUri);

    expect(filePath).toBe(join(storageUri.fsPath, 'model-settings.json'));
  });

  it('saves and loads model settings from global storage', async () => {
    const storageUri = await createStorageUri();
    const input: ModelSettingsStore = {
      'llama3.2:latest': {
        temperature: 0.4,
        top_p: 0.9,
        top_k: 40,
        num_ctx: 8192,
        num_predict: 512,
        think: true,
        think_budget: 2048,
      },
    };

    await saveModelSettings(storageUri, input);
    const loaded = await loadModelSettings(storageUri);

    expect(loaded).toEqual(input);
  });

  it('sanitizes unknown/invalid values while loading', async () => {
    const storageUri = await createStorageUri();
    const filePath = getModelSettingsFilePath(storageUri);

    await writeFile(
      filePath,
      JSON.stringify(
        {
          'llama3.2:latest': {
            temperature: 0.6,
            top_p: 'bad',
            top_k: 50,
            num_ctx: 4096,
            num_predict: -1,
            think: 'yes',
            think_budget: 1024,
            ignored: 'value',
          },
          '': {
            temperature: 1,
          },
          invalid: ['not-object'],
        },
        null,
        2,
      ),
      'utf8',
    );

    const loaded = await loadModelSettings(storageUri);

    expect(loaded).toEqual({
      'llama3.2:latest': {
        temperature: 0.6,
        top_k: 50,
        num_ctx: 4096,
        num_predict: -1,
        think_budget: 1024,
      },
      invalid: {},
    });
  });

  it('returns empty store when JSON root is not an object', async () => {
    const storageUri = await createStorageUri();
    const filePath = getModelSettingsFilePath(storageUri);

    await writeFile(filePath, JSON.stringify(['not', 'an', 'object']), 'utf8');

    const loaded = await loadModelSettings(storageUri);
    expect(loaded).toEqual({});
  });

  it('writes pretty JSON with trailing newline', async () => {
    const storageUri = await createStorageUri();
    await saveModelSettings(storageUri, { modelA: { temperature: 1 } });

    const raw = await readFile(getModelSettingsFilePath(storageUri), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('"modelA"');
  });

  it('sanitizes values while saving (drops invalid fields and empty model keys)', async () => {
    const storageUri = await createStorageUri();

    await saveModelSettings(storageUri, {
      'llama3.2:latest': {
        temperature: Number.POSITIVE_INFINITY,
        top_p: 0.92,
        think: true,
      },
      '': {
        temperature: 1,
      },
      invalid: {
        num_ctx: Number.NaN,
      },
    });

    const loaded = await loadModelSettings(storageUri);
    expect(loaded).toEqual({
      'llama3.2:latest': {
        top_p: 0.92,
        think: true,
      },
      invalid: {},
    });
  });

  it('returns empty options for unknown model', () => {
    const result = getModelOptionsForModel({ modelA: { temperature: 0.7 } }, 'missing');
    expect(result).toEqual({});
  });

  it('returns stored options for known model', () => {
    const store: ModelSettingsStore = {
      modelA: { temperature: 0.7, top_k: 30 },
    };

    const result = getModelOptionsForModel(store, 'modelA');
    expect(result).toEqual({ temperature: 0.7, top_k: 30 });
  });

  it('logs and returns empty store for malformed JSON', async () => {
    const storageUri = await createStorageUri();
    const filePath = getModelSettingsFilePath(storageUri);
    const diagnostics = {
      warn: vi.fn(),
      exception: vi.fn(),
    };

    await writeFile(filePath, '{not-json', 'utf8');

    const loaded = await loadModelSettings(storageUri, diagnostics);
    expect(loaded).toEqual({});
    expect(diagnostics.exception).toHaveBeenCalled();
  });
});
