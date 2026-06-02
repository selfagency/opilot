import { mkdir, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import type { CreateRequest, Message, Ollama } from 'ollama';
import * as vscode from 'vscode';
import type { DiagnosticsLogger } from './diagnostics.js';
import { reportError } from './error-handler.js';
import { affectsSetting, getSetting } from './settings.js';

// ---------------------------------------------------------------------------
// Hover documentation for Modelfile keywords
// ---------------------------------------------------------------------------

export const KEYWORD_DOCS: Record<string, string> = {
  FROM: '**FROM** *(required)* — Defines the base model to use.\n\n```\nFROM llama3.2:3b\nFROM ./model.gguf\n```',
  PARAMETER:
    '**PARAMETER** — Sets a runtime parameter.\n\nCommon parameters: `temperature`, `num_ctx`, `top_k`, `top_p`, `stop`, `seed`, `repeat_penalty`, `num_predict`.\n\n```\nPARAMETER temperature 0.7\nPARAMETER num_ctx 4096\n```',
  SYSTEM:
    '**SYSTEM** — Persistent system message included in every prompt.\n\n```\nSYSTEM """You are a helpful assistant."""\n```',
  TEMPLATE:
    '**TEMPLATE** — Full Go-template prompt format sent to the model. Uses `{{ .System }}`, `{{ .Prompt }}`, `{{ .Response }}`.',
  ADAPTER:
    '**ADAPTER** — Applies a fine-tuned LoRA adapter (Safetensors or GGUF) to the base model.\n\n```\nADAPTER ./lora.gguf\n```',
  LICENSE: '**LICENSE** — Legal license text for the model.\n\n```\nLICENSE """\nMIT License...\n"""\n```',
  MESSAGE:
    '**MESSAGE** — Adds a message to the conversation history to guide the model.\n\nRoles: `system`, `user`, `assistant`.\n\n```\nMESSAGE user "Hello"\nMESSAGE assistant "Hi there!"\n```',
  REQUIRES: '**REQUIRES** — Minimum Ollama version required by this Modelfile.\n\n```\nREQUIRES 0.14.0\n```'
};

/**
 * Hover documentation for individual Modelfile PARAMETER keywords.
 *
 * Each entry maps a parameter name (as it appears after `PARAMETER` in a
 * Modelfile) to a Markdown string that is shown in the VS Code hover provider.
 *
 * The set of recognised names is derived from the Ollama Modelfile spec:
 * https://github.com/ollama/ollama/blob/main/docs/modelfile.md
 *
 * Value types:
 * - `float`  — temperature, top_p, min_p, repeat_penalty, presence_penalty,
 *              frequency_penalty, mirostat_tau, mirostat_eta
 * - `int`    — num_ctx, top_k, seed, num_predict, repeat_last_n, mirostat
 * - `string` — stop (may appear multiple times for multiple stop sequences)
 *
 * When a word after `PARAMETER` matches one of these keys the hover provider
 * falls through from KEYWORD_DOCS to PARAMETER_DOCS (see provideHover).
 */
const PARAMETER_DOCS: Record<string, string> = {
  temperature: '`temperature` — Controls creativity (0.0–2.0). Higher = more creative. Default: 0.8',
  num_ctx: '`num_ctx` — Context window size in tokens. Default: 2048',
  top_k: '`top_k` — Limits vocabulary diversity. Lower = more conservative. Default: 40',
  top_p: '`top_p` — Nucleus sampling threshold (0.0–1.0). Default: 0.9',
  min_p: '`min_p` — Minimum probability for a token relative to the most likely token. Default: 0.0',
  stop: '`stop` — Stop sequence(s). Generation halts when this pattern is encountered.',
  seed: '`seed` — Random seed for deterministic generation. Default: 0',
  num_predict: '`num_predict` — Maximum tokens to generate. -1 = unlimited. Default: -1',
  repeat_last_n: '`repeat_last_n` — How far back to look for repetition. -1 = num_ctx. Default: 64',
  repeat_penalty: '`repeat_penalty` — Repetition penalty strength. Higher = stronger penalty. Default: 1.1',
  presence_penalty: '`presence_penalty` — Penalizes tokens that already appeared. Default: 0.0',
  frequency_penalty: '`frequency_penalty` — Penalizes tokens based on frequency. Default: 0.0',
  mirostat: '`mirostat` — Mirostat sampling (0=disabled, 1=v1, 2=v2). Default: 0',
  mirostat_tau: '`mirostat_tau` — Mirostat target entropy. Default: 5.0',
  mirostat_eta: '`mirostat_eta` — Mirostat learning rate. Default: 0.1'
};

// ---------------------------------------------------------------------------
// Modelfile parser — extracts structured fields for the Ollama create API
// ---------------------------------------------------------------------------

interface ParsedModelfile {
  adapters?: Record<string, string>;
  from?: string;
  license?: string | string[];
  messages?: Message[];
  parameters?: Record<string, unknown>;
  system?: string;
  template?: string;
}

/**
 * Parse Modelfile content into structured fields for the Ollama create API.
 *
 * Supports multi-line values delimited by triple-quotes (`"""`).
 *
 * Security model:
 * - All field values (`FROM`, `SYSTEM`, `TEMPLATE`, etc.) are treated as opaque
 *   strings and forwarded to the locally running Ollama server via its create API.
 *   The extension does not interpret or execute these values directly, so template
 *   injection and path traversal attacks in this layer affect only the user's own
 *   local Ollama server — which runs with the user's own OS permissions.
 * - The `FROM` and `ADAPTER` fields may contain file system paths. The extension
 *   passes these verbatim to Ollama; it does not open or read those files itself.
 * - `PARAMETER` values are coerced to numbers when numeric; only the PARAMETER_DOCS
 *   key names (not the values) are used for hover documentation. No user-supplied
 *   parameter value reaches any context where injection is possible.
 */
function parseQuotedValue(value: string, lines: string[], lineIndex: { i: number }): string {
  if (value.startsWith('"""')) {
    const afterOpen = value.slice(3);
    if (afterOpen.endsWith('"""') && afterOpen.length > 3) {
      return afterOpen.slice(0, -3);
    }
    const parts = [afterOpen];
    lineIndex.i++;
    while (lineIndex.i < lines.length) {
      const nextLine = lines[lineIndex.i];
      if (nextLine.trim() === '"""' || nextLine.trimEnd().endsWith('"""')) {
        const closing = nextLine.trimEnd();
        if (closing !== '"""') {
          parts.push(closing.slice(0, -3));
        }
        break;
      }
      parts.push(nextLine);
      lineIndex.i++;
    }
    return parts.join('\n');
  }
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
}

function parseParameter(value: string, parameters: Record<string, unknown>): void {
  const spaceIdx = value.indexOf(' ');
  if (spaceIdx !== -1) {
    const paramName = value.slice(0, spaceIdx);
    const paramValue = value.slice(spaceIdx + 1).trim();
    const numVal = Number(paramValue);
    parameters[paramName] = Number.isFinite(numVal) ? numVal : paramValue;
  }
}

function parseMessage(value: string, messages: Message[]): void {
  const msgMatch = /^(system|user|assistant)\s+(.+)$/s.exec(value);
  if (msgMatch) {
    let msgContent = msgMatch[2];
    if (msgContent.startsWith('"') && msgContent.endsWith('"')) {
      msgContent = msgContent.slice(1, -1);
    }
    messages.push({
      role: msgMatch[1] as 'system' | 'user' | 'assistant',
      content: msgContent
    });
  }
}

export function parseModelfile(content: string): ParsedModelfile {
  const result: ParsedModelfile = {};
  const parameters: Record<string, unknown> = {};
  const messages: Message[] = [];
  const licenses: string[] = [];
  const lines = content.split('\n');
  const lineIndex = { i: 0 };

  while (lineIndex.i < lines.length) {
    const line = lines[lineIndex.i];
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      lineIndex.i++;
      continue;
    }

    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) {
      lineIndex.i++;
      continue;
    }

    const keyword = trimmed.slice(0, spaceIdx).toUpperCase();
    let value = trimmed.slice(spaceIdx + 1).trim();
    value = parseQuotedValue(value, lines, lineIndex);

    switch (keyword) {
      case 'FROM':
        result.from = value;
        break;
      case 'SYSTEM':
        result.system = value;
        break;
      case 'TEMPLATE':
        result.template = value;
        break;
      case 'LICENSE':
        licenses.push(value);
        break;
      case 'ADAPTER':
        result.adapters ??= {};

        result.adapters[value] = value;
        break;
      case 'PARAMETER':
        parseParameter(value, parameters);
        break;
      case 'MESSAGE':
        parseMessage(value, messages);
        break;
      default:
        break;
    }
    lineIndex.i++;
  }

  if (Object.keys(parameters).length > 0) {
    result.parameters = parameters;
  }
  if (messages.length > 0) {
    result.messages = messages;
  }
  if (licenses.length === 1) {
    result.license = licenses[0];
  } else if (licenses.length > 1) {
    result.license = licenses;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Folder helpers
// ---------------------------------------------------------------------------

export function getModelfilesFolder(
  config: Pick<vscode.WorkspaceConfiguration, 'get'>,
  home: string,
  workspaceFolderPath?: string
): string {
  const configuredPath = (config.get<string>('modelfilesPath') || '').trim();
  if (!configuredPath) {
    return join(home, '.ollama', 'modelfiles');
  }

  const expandedHomePath = configuredPath.startsWith('~')
    ? join(home, configuredPath.slice(1).replace(/^[/\\]/, ''))
    : configuredPath;

  if (isAbsolute(expandedHomePath)) {
    return expandedHomePath;
  }

  if (workspaceFolderPath) {
    return resolve(workspaceFolderPath, expandedHomePath);
  }

  return resolve(home, expandedHomePath);
}

export async function ensureModelfilesFolder(folderPath: string): Promise<void> {
  await mkdir(folderPath, { recursive: true });
}

// ---------------------------------------------------------------------------
// Tree item
// ---------------------------------------------------------------------------

function createThemeIcon(id: string): vscode.ThemeIcon {
  return new vscode.ThemeIcon(id);
}

export class ModelfileItem extends vscode.TreeItem {
  readonly uri: vscode.Uri;

  constructor(uri: vscode.Uri) {
    super(basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
    this.uri = uri;
    this.contextValue = 'modelfile';
    this.iconPath = createThemeIcon('file-code');
    this.tooltip = uri.fsPath;
  }
}

// ---------------------------------------------------------------------------
// Tree data provider
// ---------------------------------------------------------------------------

export class ModelfilesProvider implements vscode.TreeDataProvider<ModelfileItem> {
  private readonly treeChangeEmitter = new vscode.EventEmitter<ModelfileItem | null>();
  readonly onDidChangeTreeData: vscode.Event<ModelfileItem | null> = this.treeChangeEmitter.event;

  private folderPath: string;
  private readonly log?: DiagnosticsLogger;

  constructor(context: vscode.ExtensionContext, log?: DiagnosticsLogger) {
    this.log = log;
    this.folderPath = getModelfilesFolder(
      {
        get: <T>(_key: string) => getSetting<T>('modelfilesPath') as T
      },
      homedir(),
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    );

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.folderPath, '{*.modelfile,Modelfile}')
    );
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
    context.subscriptions.push(watcher);

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (affectsSetting(e, 'modelfilesPath')) {
          this.folderPath = getModelfilesFolder(
            {
              get: <T>(_key: string) => getSetting<T>('modelfilesPath') as T
            },
            homedir(),
            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
          );
          this.refresh();
        }
      })
    );
  }

  getFolderPath(): string {
    return this.folderPath;
  }

  refresh(): void {
    this.treeChangeEmitter.fire(null);
  }

  getTreeItem(element: ModelfileItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<ModelfileItem[]> {
    try {
      await ensureModelfilesFolder(this.folderPath);
      const entries = await readdir(this.folderPath, { withFileTypes: true });
      return entries
        .filter(e => e.isFile() && (e.name.endsWith('.modelfile') || e.name === 'Modelfile'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(e => new ModelfileItem(vscode.Uri.file(join(this.folderPath, e.name))));
    } catch (error) {
      reportError(this.log, 'Failed to read modelfiles folder', error, {
        showToUser: false
      });
      return [];
    }
  }
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

export async function handleNewModelfile(folderPath: string, client: Ollama): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: 'Modelfile name (without extension)',
    placeHolder: 'e.g. pirate-bot',
    validateInput: v => {
      if (!v) {
        return 'Name is required';
      }
      if (/[/\\]/.test(v)) {
        return 'Name cannot contain path separators';
      }
      return null;
    }
  });
  if (!name) {
    return;
  }

  // Fetch available local models for the quick pick
  let modelItems: vscode.QuickPickItem[] = [];
  try {
    const { models } = await client.list();
    modelItems = models.map(m => ({ label: m.name, description: 'local' }));
  } catch {
    // If Ollama is unreachable, fall back to a manual entry
    modelItems = [];
  }

  const selectedModel = await vscode.window.showQuickPick(
    modelItems.length > 0 ? modelItems : [{ label: 'llama3.2:3b', description: 'default' }],
    {
      placeHolder: 'Select a base model',
      title: 'New Modelfile — choose base model'
    }
  );
  if (!selectedModel) {
    return;
  }

  const systemPrompt = await vscode.window.showInputBox({
    prompt: 'System prompt (describes the AI persona or task)',
    placeHolder: 'e.g. You are a helpful pirate assistant. Arr!',
    value: 'You are a helpful assistant.'
  });
  if (systemPrompt === undefined) {
    return;
  }

  const fileName = name.endsWith('.modelfile') ? name : `${name}.modelfile`;
  const uri = vscode.Uri.file(join(folderPath, fileName));

  const content = [
    `# Modelfile — ${name}`,
    `FROM ${selectedModel.label}`,
    '',
    `SYSTEM """${systemPrompt}"""`,
    '',
    'PARAMETER temperature 0.7',
    'PARAMETER num_ctx 4096',
    ''
  ].join('\n');

  await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}

async function buildModelfileStream(
  item: ModelfileItem,
  modelName: string,
  client: Ollama,
  progress: vscode.Progress<{ message?: string }>,
  log?: DiagnosticsLogger
): Promise<void> {
  const content = await readFile(item.uri.fsPath, 'utf8');
  const parsed = parseModelfile(content);

  if (!parsed.from) {
    vscode.window.showErrorMessage('Modelfile is missing the required FROM directive.');
    return;
  }

  const createRequest: CreateRequest & { stream: true } = {
    model: modelName,
    from: parsed.from,
    stream: true,
    ...(parsed.system ? { system: parsed.system } : {}),
    ...(parsed.template ? { template: parsed.template } : {}),
    ...(parsed.license ? { license: parsed.license } : {}),
    ...(parsed.parameters ? { parameters: parsed.parameters } : {}),
    ...(parsed.messages ? { messages: parsed.messages } : {}),
    ...(parsed.adapters ? { adapters: parsed.adapters } : {})
  };

  const stream = await client.create(createRequest);

  for await (const chunk of stream) {
    if (chunk.status) {
      progress.report({ message: chunk.status });
    }
  }

  log?.info(`[client] model built: ${modelName}`);
  await vscode.commands.executeCommand('opilot.refreshLocalModels');
  vscode.window.showInformationMessage(`Model "${modelName}" built successfully`);
}

export async function handleBuildModelfile(
  item: ModelfileItem,
  client: Ollama,
  log?: DiagnosticsLogger
): Promise<void> {
  const defaultName = basename(item.uri.fsPath, '.modelfile');

  const modelName = await vscode.window.showInputBox({
    prompt: 'Model name to create',
    value: defaultName,
    validateInput: v => (v ? null : 'Model name is required')
  });
  if (!modelName) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Building ${modelName}`,
      cancellable: false
    },
    async progress => {
      try {
        await buildModelfileStream(item, modelName, client, progress, log);
      } catch (error) {
        reportError(log, 'Failed to build model', error, { showToUser: true });
      }
    }
  );
}

export async function handleOpenModelfilesFolder(folderPath: string, log?: DiagnosticsLogger): Promise<void> {
  try {
    await ensureModelfilesFolder(folderPath);
    log?.info(`[client] opening modelfiles folder: ${folderPath}`);
    const folderUri = vscode.Uri.file(folderPath);
    const opened = await vscode.env.openExternal(folderUri);
    if (!opened) {
      await vscode.commands.executeCommand('revealFileInOS', folderUri);
    }
  } catch (error) {
    reportError(log, 'Failed to open Modelfiles folder', error, {
      showToUser: true
    });
  }
}

// ---------------------------------------------------------------------------
// Language feature providers
// ---------------------------------------------------------------------------

export function createHoverProvider(): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const wordRange = document.getWordRangeAtPosition(position, /[A-Z_a-z][A-Z_a-z0-9]*/);
      if (!wordRange) {
        return null;
      }

      const word = document.getText(wordRange);
      const doc = KEYWORD_DOCS[word] ?? PARAMETER_DOCS[word];
      if (!doc) {
        return null;
      }

      return new vscode.Hover(new vscode.MarkdownString(doc), wordRange);
    }
  };
}

export function createCompletionProvider(): vscode.CompletionItemProvider {
  const keywords = [
    {
      label: 'FROM',
      detail: 'Base model (required)',
      snippet: 'FROM ${1:llama3.2:3b}'
    },
    {
      label: 'SYSTEM',
      detail: 'System message',
      snippet: 'SYSTEM """${1:You are a helpful assistant.}"""'
    },
    {
      label: 'PARAMETER',
      detail: 'Runtime parameter',
      snippet: 'PARAMETER ${1:temperature} ${2:0.7}'
    },
    {
      label: 'TEMPLATE',
      detail: 'Full prompt template',
      snippet: 'TEMPLATE """${1:{{ .Prompt }}}"""'
    },
    {
      label: 'ADAPTER',
      detail: 'LoRA adapter path',
      snippet: 'ADAPTER ${1:./adapter.gguf}'
    },
    {
      label: 'LICENSE',
      detail: 'Model license',
      snippet: 'LICENSE """${1:MIT}"""'
    },
    {
      label: 'MESSAGE',
      detail: 'Conversation history',
      snippet: 'MESSAGE ${1|user,assistant,system|} "${2}"'
    },
    {
      label: 'REQUIRES',
      detail: 'Minimum Ollama version',
      snippet: 'REQUIRES ${1:0.14.0}'
    }
  ];

  const params = Object.entries(PARAMETER_DOCS).map(([name, detail]) => ({
    label: name,
    detail,
    kind: vscode.CompletionItemKind.Property
  }));

  return {
    provideCompletionItems(document, position) {
      const lineText = document.lineAt(position).text.slice(0, position.character);
      const isParameterLine = /^PARAMETER\s+\w*$/.test(lineText);

      if (isParameterLine) {
        return params.map(p => {
          const item = new vscode.CompletionItem(p.label, vscode.CompletionItemKind.Property);
          item.detail = p.detail;
          return item;
        });
      }

      // At line start — suggest keywords
      if (/^\s*[A-Z]*$/.test(lineText)) {
        return keywords.map(k => {
          const item = new vscode.CompletionItem(k.label, vscode.CompletionItemKind.Keyword);
          item.detail = k.detail;
          item.insertText = new vscode.SnippetString(k.snippet);
          return item;
        });
      }

      return [];
    }
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register the Modelfiles tree data provider synchronously, without requiring
 * the Ollama client. Call this at the top of `activate()` before any `await`
 * so VS Code finds a provider for the `ollama-modelfiles` view immediately.
 * Returns the provider so commands can be wired later via
 * {@link registerModelfileCommands}.
 */
export function registerModelfilesProvider(
  context: vscode.ExtensionContext,
  log?: DiagnosticsLogger
): ModelfilesProvider {
  const provider = new ModelfilesProvider(context, log);
  context.subscriptions.push(vscode.window.registerTreeDataProvider('ollama-modelfiles', provider));
  return provider;
}

/**
 * Register client-dependent Modelfile commands and language features.
 * Call this after the Ollama client is available (i.e. after the async
 * setup in `activate()` completes).
 */
export function registerModelfileCommands(
  context: vscode.ExtensionContext,
  provider: ModelfilesProvider,
  client: Ollama,
  log?: DiagnosticsLogger
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('opilot.refreshModelfiles', () => provider.refresh()),
    vscode.commands.registerCommand('opilot.newModelfile', () => handleNewModelfile(provider.getFolderPath(), client)),
    vscode.commands.registerCommand('opilot.editModelfile', (item: ModelfileItem) =>
      vscode.commands.executeCommand('vscode.open', item.uri)
    ),
    vscode.commands.registerCommand('opilot.buildModelfile', (item: ModelfileItem) =>
      handleBuildModelfile(item, client, log)
    ),
    vscode.commands.registerCommand('opilot.openModelfilesFolder', async () =>
      handleOpenModelfilesFolder(provider.getFolderPath(), log)
    ),
    vscode.languages.registerHoverProvider({ language: 'modelfile' }, createHoverProvider()),
    vscode.languages.registerCompletionItemProvider({ language: 'modelfile' }, createCompletionProvider(), ' ')
  );
}

/**
 * @deprecated Use {@link registerModelfilesProvider} + {@link registerModelfileCommands} instead.
 * Kept for backwards compatibility — callers that cannot split registration
 * may still use this, but the view will suffer the async-gap "no data provider"
 * error if the sidebar is visible on startup.
 */
export function registerModelfileManager(
  context: vscode.ExtensionContext,
  client: Ollama,
  log?: DiagnosticsLogger
): void {
  const provider = registerModelfilesProvider(context, log);
  registerModelfileCommands(context, provider, client, log);
}
