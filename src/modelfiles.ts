import { mkdir, readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import * as vscode from 'vscode';
import type { Ollama, CreateRequest } from 'ollama';
import type { DiagnosticsLogger } from './diagnostics.js';

// ---------------------------------------------------------------------------
// Hover documentation for Modelfile keywords
// ---------------------------------------------------------------------------

const KEYWORD_DOCS: Record<string, string> = {
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
  REQUIRES:
    '**REQUIRES** — Minimum Ollama version required by this Modelfile.\n\n```\nREQUIRES 0.14.0\n```',
};

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
  mirostat_eta: '`mirostat_eta` — Mirostat learning rate. Default: 0.1',
};

// ---------------------------------------------------------------------------
// Folder helpers
// ---------------------------------------------------------------------------

export function getModelfilesFolder(
  config: Pick<vscode.WorkspaceConfiguration, 'get'>,
  home: string,
): string {
  return config.get<string>('modelfilesPath') || join(home, '.ollama', 'modelfiles');
}

export async function ensureModelfilesFolder(folderPath: string): Promise<void> {
  await mkdir(folderPath, { recursive: true });
}

// ---------------------------------------------------------------------------
// Tree item
// ---------------------------------------------------------------------------

export class ModelfileItem extends vscode.TreeItem {
  constructor(public readonly uri: vscode.Uri) {
    super(basename(uri.fsPath), vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'modelfile';
    this.iconPath = { id: 'file-code' } as unknown as vscode.ThemeIcon;
    this.tooltip = uri.fsPath;
    this.command = { command: 'vscode.open', title: 'Open Modelfile', arguments: [uri] };
  }
}

// ---------------------------------------------------------------------------
// Tree data provider
// ---------------------------------------------------------------------------

export class ModelfilesProvider implements vscode.TreeDataProvider<ModelfileItem> {
  private treeChangeEmitter = new vscode.EventEmitter<ModelfileItem | null>();
  readonly onDidChangeTreeData: vscode.Event<ModelfileItem | null> = this.treeChangeEmitter.event;

  private folderPath: string;

  constructor(
    context: vscode.ExtensionContext,
    private readonly log?: DiagnosticsLogger,
  ) {
    this.folderPath = getModelfilesFolder(vscode.workspace.getConfiguration('ollama'), homedir());

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.folderPath, '{*.modelfile,Modelfile}'),
    );
    watcher.onDidCreate(() => this.refresh());
    watcher.onDidDelete(() => this.refresh());
    watcher.onDidChange(() => this.refresh());
    context.subscriptions.push(watcher);

    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('ollama.modelfilesPath')) {
          this.folderPath = getModelfilesFolder(
            vscode.workspace.getConfiguration('ollama'),
            homedir(),
          );
          this.refresh();
        }
      }),
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
      this.log?.error(`[Ollama] Failed to read modelfiles folder: ${String(error)}`);
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
      if (!v) return 'Name is required';
      if (/[/\\]/.test(v)) return 'Name cannot contain path separators';
      return null;
    },
  });
  if (!name) return;

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
    modelItems.length > 0
      ? modelItems
      : [{ label: 'llama3.2:3b', description: 'default' }],
    {
      placeHolder: 'Select a base model',
      title: 'New Modelfile — choose base model',
    },
  );
  if (!selectedModel) return;

  const systemPrompt = await vscode.window.showInputBox({
    prompt: 'System prompt (describes the AI persona or task)',
    placeHolder: 'e.g. You are a helpful pirate assistant. Arr!',
    value: 'You are a helpful assistant.',
  });
  if (systemPrompt === undefined) return;

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
    '',
  ].join('\n');

  await vscode.workspace.fs.writeFile(uri, Buffer.from(content));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}

export async function handleBuildModelfile(
  item: ModelfileItem,
  client: Ollama,
  log?: DiagnosticsLogger,
): Promise<void> {
  const defaultName = basename(item.uri.fsPath, '.modelfile');

  const modelName = await vscode.window.showInputBox({
    prompt: 'Model name to create',
    value: defaultName,
    validateInput: v => (!v ? 'Model name is required' : null),
  });
  if (!modelName) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Building ${modelName}`, cancellable: false },
    async progress => {
      try {
        const content = await readFile(item.uri.fsPath, 'utf8');

        // The SDK's CreateRequest type doesn't expose `modelfile` (raw content),
        // but the Ollama REST API accepts it. We cast through unknown here.
        const stream = await client.create({
          model: modelName,
          modelfile: content,
          stream: true,
        } as unknown as CreateRequest & { stream: true });

        for await (const chunk of stream) {
          if (chunk.status) {
            progress.report({ message: chunk.status });
          }
        }

        log?.info(`[Ollama] Model built: ${modelName}`);
        await vscode.commands.executeCommand('ollama-copilot.refreshLocalModels');
        vscode.window.showInformationMessage(`Model "${modelName}" built successfully`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log?.error(`[Ollama] Failed to build model: ${msg}`);
        vscode.window.showErrorMessage(`Failed to build model: ${msg}`);
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Language feature providers
// ---------------------------------------------------------------------------

export function createHoverProvider(): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const wordRange = document.getWordRangeAtPosition(position, /[A-Z_a-z][A-Z_a-z0-9]*/);
      if (!wordRange) return null;

      const word = document.getText(wordRange);
      const doc = KEYWORD_DOCS[word] ?? PARAMETER_DOCS[word];
      if (!doc) return null;

      return new vscode.Hover(new vscode.MarkdownString(doc), wordRange);
    },
  };
}

export function createCompletionProvider(): vscode.CompletionItemProvider {
  const keywords = [
    { label: 'FROM', detail: 'Base model (required)', snippet: 'FROM ${1:llama3.2:3b}' },
    { label: 'SYSTEM', detail: 'System message', snippet: 'SYSTEM """${1:You are a helpful assistant.}"""' },
    { label: 'PARAMETER', detail: 'Runtime parameter', snippet: 'PARAMETER ${1:temperature} ${2:0.7}' },
    { label: 'TEMPLATE', detail: 'Full prompt template', snippet: 'TEMPLATE """${1:{{ .Prompt }}}"""' },
    { label: 'ADAPTER', detail: 'LoRA adapter path', snippet: 'ADAPTER ${1:./adapter.gguf}' },
    { label: 'LICENSE', detail: 'Model license', snippet: 'LICENSE """${1:MIT}"""' },
    { label: 'MESSAGE', detail: 'Conversation history', snippet: 'MESSAGE ${1|user,assistant,system|} "${2}"' },
    { label: 'REQUIRES', detail: 'Minimum Ollama version', snippet: 'REQUIRES ${1:0.14.0}' },
  ];

  const params = Object.entries(PARAMETER_DOCS).map(([name, detail]) => ({
    label: name,
    detail,
    kind: vscode.CompletionItemKind.Property,
  }));

  return {
    provideCompletionItems(document, position) {
      const lineText = document.lineAt(position).text.substring(0, position.character);
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
    },
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerModelfileManager(
  context: vscode.ExtensionContext,
  client: Ollama,
  log?: DiagnosticsLogger,
): void {
  const provider = new ModelfilesProvider(context, log);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('ollama-modelfiles', provider),
    vscode.commands.registerCommand('ollama-copilot.refreshModelfiles', () => provider.refresh()),
    vscode.commands.registerCommand('ollama-copilot.newModelfile', () =>
      handleNewModelfile(provider.getFolderPath(), client),
    ),
    vscode.commands.registerCommand('ollama-copilot.editModelfile', (item: ModelfileItem) =>
      vscode.commands.executeCommand('vscode.open', item.uri),
    ),
    vscode.commands.registerCommand('ollama-copilot.buildModelfile', (item: ModelfileItem) =>
      handleBuildModelfile(item, client, log),
    ),
    vscode.commands.registerCommand('ollama-copilot.openModelfilesFolder', () =>
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(provider.getFolderPath())),
    ),
    vscode.languages.registerHoverProvider({ language: 'modelfile' }, createHoverProvider()),
    vscode.languages.registerCompletionItemProvider(
      { language: 'modelfile' },
      createCompletionProvider(),
      ' ',
    ),
  );
}
