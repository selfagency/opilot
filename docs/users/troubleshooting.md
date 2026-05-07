---
title: Troubleshooting
---

## Connection Issues

### "Could not connect to Ollama"

The extension cannot reach the Ollama API at `ollama.host`.

**Checklist:**

1. Is Ollama running? Open a terminal and run:

   ```bash
   ollama list
   ```

   If this fails, start Ollama:
   - **macOS/Linux**: `ollama serve` or open the Ollama app
   - **Windows**: Open the Ollama app from the Start menu

2. Is the host URL correct? Check `ollama.host` in settings. Default is `http://localhost:11434`.

3. For remote instances — is the server reachable from your machine?

   ```bash
   curl http://your-server:11434/api/version
   ```

4. If using HTTPS or a reverse proxy: check that certificates are valid and the proxy forwards the `Authorization` header.

### "Connection refused" on a remote instance

Ollama only listens on `localhost` by default. To expose it on all interfaces, set the environment variable before starting:

```bash
OLLAMA_HOST=0.0.0.0 ollama serve
```

Or on macOS, set it in the Ollama app preferences under **Environment Variables**.

### Auth token not working

The auth token is stored in [VS Code's encrypted secret store](https://code.visualstudio.com/api/references/vscode-api#SecretStorage), not in `settings.json`. To update it:

1. Open Command Palette → **"Ollama: Manage Ollama Auth Token"**
2. Enter the new token value

---

## Models Not Appearing

### Local Models panel is empty

1. Make sure at least one model is installed:

   ```bash
   ollama pull llama3.2:3b
   ```

2. Click the **Refresh** button in the Local Models panel
3. Check the **Opilot** output channel for error messages

### Models disappear after VS Code restart

The extension auto-refreshes on startup. If models are missing, Ollama may not have started yet. Click Refresh once Ollama is running.

### Running models not shown

Running models are fetched from `GET /api/ps`. If none appear, the model may have been unloaded. Use **Start Model** from the sidebar to warm it up.

---

## Ollama in Copilot Chat

### `@ollama` doesn't appear in chat

- Ensure the extension is installed and enabled
- Ensure GitHub Copilot Chat is installed and active
- Restart VS Code

### Chat responds with the wrong model

Click the model picker icon (✦) inside the Copilot Chat input, select **🦙 Ollama**, then pick the model you want. The `@ollama` participant also lets you change the model via the model picker that appears when you start a conversation.

### "Model not found" in chat

The model must be installed locally. Pull it first:

```bash
ollama pull <modelname>
```

Or use the **Library** panel → right-click → **Pull Model**.

### Thinking tags appear in responses

Some reasoning-capable models (DeepSeek R1, QwQ, etc.) output `<think>...</think>` blocks. The extension strips these before displaying the response. If you see raw XML-like tags, check that your model name is being recognized as a thinking model:

- Open the output channel: **View → Output → Opilot**
- Look for `Stripping thinking block` log lines

If not present, the model name may not match the thinking model pattern. Report it as an issue on GitHub.

---

## Inline Completions

### No completions appearing

1. Confirm `ollama.completionModel` is set to an installed model
2. Confirm `ollama.enableInlineCompletions` is `true`
3. Check that inline completions are enabled in VS Code:
   - **File → Preferences → Settings** → search "editor.inlineSuggest.enabled" → set to `true`
4. Completions are triggered after a short pause while typing — make sure you paused after entering code

### Completions are slow

Use a smaller, faster model for completions. Recommended:

- `qwen2.5-coder:1.5b`
- `deepseek-coder:1.3b`
- `starcoder2:3b`

Larger models (7B+) will have noticeable latency even on capable hardware.

---

## Modelfiles

### "Build failed"

- Open the **Opilot** output channel for the raw error from `ollama create`
- Check your Modelfile syntax: the `FROM` instruction is required
- Ensure the base model is installed: `ollama pull <base-model>`
- Model names must be lowercase alphanumeric with hyphens only

### Modelfiles panel is empty

- Check the `ollama.modelfilesPath` setting (default: `~/.ollama/modelfiles`)
- If the folder doesn't exist, create it: `mkdir -p ~/.ollama/modelfiles`
- Click **Refresh Modelfiles** in the panel header

---

## Performance

### High CPU/memory usage

The extension polls the Ollama API on a timer. If you have many models and a short refresh interval, try increasing:

```json
"ollama.localModelRefreshInterval": 60
```

### Slow Copilot chat responses

Local model performance depends entirely on hardware. Large models (13B+) require a GPU with sufficient VRAM for acceptable speed. For fast responses:

- Use a quantized model (`:q4_K_M`)
- Use a smaller model family
- Ensure GPU offloading is active — check `ollama ps` and confirm layers are on GPU

---

## Logs and Diagnostics

### Opening the output channel

**View → Output** → dropdown → **Opilot**

Or run Command Palette → **"Ollama: Dump Performance Snapshot"** to see timing data.

### Server log streaming

When `ollama.streamLogs` is `true`, Ollama's own server logs are appended to the output channel. This can show model loading errors, GPU allocation failures, and API request tracing.

Set `ollama.diagnostics.logLevel` to `"debug"` for maximum verbosity.

---

## Still Having Problems?

1. Check existing issues: [github.com/selfagency/opilot/issues](https://github.com/selfagency/opilot/issues)
2. Open the output channel and copy the relevant log lines
3. File a new issue with:
   - OS and VS Code version
   - Ollama version (`ollama --version`)
   - Extension version
   - Relevant output channel logs
