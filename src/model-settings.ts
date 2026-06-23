import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DiagnosticsLogger } from './diagnostics.js';

const MODEL_SETTINGS_FILE = 'model-settings.json';

/**
 * Minimal context shape required by the model settings helpers.
 * Compatible with `vscode.ExtensionContext` but avoids importing the full type.
 */
export interface ModelSettingsContext {
  globalStorageUri: { fsPath: string };
}

/**
 * Thinking effort level.
 * - `true` / `false`: standard boolean toggle (most models)
 * - `'low' | 'medium' | 'high'`: effort level for GPT-OSS and similar models
 * - `undefined`: model default
 */
export type ThinkValue = boolean | 'low' | 'medium' | 'high';

/**
 * Per-model generation options that can be persisted per model ID.
 * All fields are optional; only set values override Ollama defaults.
 */
export interface ModelOptions {
  frequency_penalty?: number;
  num_ctx?: number;
  num_predict?: number;
  presence_penalty?: number;
  seed?: number;
  stop?: string | string[];
  temperature?: number;
  think?: ThinkValue;
  think_budget?: number;
  top_k?: number;
  top_p?: number;
}

export type ModelOptionOverrides = ModelOptions;

export type ModelSettingsStore = Record<string, ModelOptionOverrides>;

type StorageUri = Pick<{ fsPath: string }, 'fsPath'>;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeModelOptions(value: unknown): ModelOptionOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const sanitized: ModelOptionOverrides = {};

  if (isFiniteNumber(candidate.temperature)) {
    sanitized.temperature = candidate.temperature;
  }
  if (isFiniteNumber(candidate.top_p)) {
    sanitized.top_p = candidate.top_p;
  }
  if (isFiniteNumber(candidate.top_k)) {
    sanitized.top_k = candidate.top_k;
  }
  if (isFiniteNumber(candidate.num_ctx)) {
    sanitized.num_ctx = candidate.num_ctx;
  }
  if (isFiniteNumber(candidate.num_predict)) {
    sanitized.num_predict = candidate.num_predict;
  }
  if (
    typeof candidate.think === 'boolean' ||
    candidate.think === 'low' ||
    candidate.think === 'medium' ||
    candidate.think === 'high'
  ) {
    sanitized.think = candidate.think;
  }
  if (isFiniteNumber(candidate.think_budget)) {
    sanitized.think_budget = candidate.think_budget;
  }
  if (isFiniteNumber(candidate.seed)) {
    sanitized.seed = candidate.seed;
  }
  if (
    typeof candidate.stop === 'string' ||
    (Array.isArray(candidate.stop) && candidate.stop.every(s => typeof s === 'string'))
  ) {
    sanitized.stop = candidate.stop;
  }
  if (isFiniteNumber(candidate.frequency_penalty)) {
    sanitized.frequency_penalty = candidate.frequency_penalty;
  }
  if (isFiniteNumber(candidate.presence_penalty)) {
    sanitized.presence_penalty = candidate.presence_penalty;
  }

  return sanitized;
}

function sanitizeStore(value: unknown): ModelSettingsStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const sanitized: ModelSettingsStore = {};

  for (const [modelId, options] of Object.entries(raw)) {
    if (!modelId) {
      continue;
    }
    sanitized[modelId] = sanitizeModelOptions(options);
  }

  return sanitized;
}

export function getModelSettingsFilePath(globalStorageUri: StorageUri): string {
  return join(globalStorageUri.fsPath, MODEL_SETTINGS_FILE);
}

export async function loadModelSettings(
  globalStorageUri: StorageUri,
  diagnostics?: Pick<DiagnosticsLogger, 'warn' | 'exception'>
): Promise<ModelSettingsStore> {
  const filePath = getModelSettingsFilePath(globalStorageUri);

  try {
    const raw = await readFile(filePath, 'utf8');
    return sanitizeStore(JSON.parse(raw));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === 'ENOENT') {
      return {};
    }

    diagnostics?.exception('[model-settings] failed to load model settings, using defaults', error);
    return {};
  }
}

export async function saveModelSettings(
  globalStorageUri: StorageUri,
  store: ModelSettingsStore,
  diagnostics?: Pick<DiagnosticsLogger, 'exception'>
): Promise<void> {
  const filePath = getModelSettingsFilePath(globalStorageUri);

  try {
    await mkdir(globalStorageUri.fsPath, { recursive: true });
    await writeFile(filePath, `${JSON.stringify(sanitizeStore(store), null, 2)}\n`, 'utf8');
  } catch (error) {
    diagnostics?.exception('[model-settings] failed to save model settings', error);
    throw error;
  }
}

export function getModelOptionsForModel(store: ModelSettingsStore, modelId: string): ModelOptionOverrides {
  return store[modelId] ?? {};
}
