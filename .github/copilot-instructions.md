# GitHub Copilot Instructions for Agent: Visual Studio Code Extension Integrating Ollama into GitHub Copilot Chat

Welcome! This document guides you through the recommended workflows, conventions, and tooling when working on the **Ollama for Copilot** VS Code extension project. Follow these instructions strictly to ensure consistency, quality, and smooth collaboration.

---

## 1. Before Starting Work: Beans Issue Management

- **Always start with a bean.** Search for an existing bean relevant to your task using the Beans VS Code extension or `@beans` chat participant.
- If none exists, create a new bean and set its status to `in-progress`.
- Maintain all work tracking in the bean's `## Todo` checklist in the bean body.
- Use the Beans extension or MCP tools for all bean operations; CLI only as last resort.
- **Create or switch to the issue branch before editing code.**
- Branch name format: `[type]/[issue-number-without-prefix]-[short-title]` (e.g., `feat/1234-add-ollama-integration`).
- Add the branch and PR number to the bean’s frontmatter immediately after creation.
- Commit the bean promptly after creation or updates.

---

## 2. Project Overview

You are working on the **Ollama for Copilot** extension, which integrates Ollama models into GitHub Copilot Chat inside VS Code.

### Key Features to Keep in Mind

- Local and cloud Ollama model usage inside Copilot Chat.
- Custom Ollama sidebar for model management.
- `@ollama` chat participant for dedicated conversations.
- Inline code completions using local models.
- Modelfile creation, editing, and building with syntax support.
- Streaming responses and vision model support.
- Local execution for privacy.
- Configuration via VS Code settings.

---

## 3. Development Environment Setup

- **Prerequisites:**

- Node.js 20+
- pnpm (version pinned in `package.json`)
- VS Code 1.109.0 or higher
- GitHub Copilot Chat extension installed
- Ollama installed locally or remote access configured

- **Installing Ollama:**

- Download from [https://ollama.ai/download](https://ollama.ai/download)
- Start Ollama app or run `ollama serve`
- Login to Ollama Cloud if using cloud models (`ollama login`)

- **Extension Installation:**

- Install from VS Code Marketplace or `.vsix` file

---

## 4. Task Execution Using Taskfile

Use the provided `Taskfile.yml` to run common commands. Run tasks with:

```bash
task <taskname>
```

### Common tasks

| Task Name          | Description                                | Usage Example             |
| ------------------ | ------------------------------------------ | ------------------------- |
| check-types        | Type checking                              | `task check-types`        |
| lint               | Run linter                                 | `task lint`               |
| lint-fix           | Auto-fix linter issues                     | `task lint-fix`           |
| check-formatting   | Check code formatting                      | `task check-formatting`   |
| compile            | Compile the extension                      | `task compile`            |
| unit-tests         | Run unit tests                             | `task unit-tests`         |
| unit-test-coverage | Unit tests with coverage                   | `task unit-test-coverage` |
| extension-tests    | Run VS Code extension tests                | `task extension-tests`    |
| integration-tests  | Run integration tests (pulls models first) | `task integration-tests`  |
| precommit          | Run pre-commit checks                      | `task precommit`          |
| release            | Release the extension                      | `task release`            |
| watch              | Watch source and recompile                 | `task watch`              |

---

## 5. Code Contribution Workflow

1. **Start or resume work on the correct bean and branch.**
2. **Update the bean's `## Todo` checklist** to reflect your progress after every meaningful step.
3. **Run pre-commit tasks before committing:**

   ```bash
   task precommit
   ```

4. **Test your changes thoroughly:**
   - Unit tests: `task unit-tests`
   - Extension tests: `task extension-tests`
   - Integration tests: `task integration-tests`
5. **Build the extension before release or PR:**

   ```bash
   task compile
   ```

6. **Push your branch and update the bean frontmatter with branch and PR info.**
7. **On completion, add a `## Summary of Changes` section in the bean and mark it `completed`.**

---

## 6. Working with Beans (Issues)

- Use the Beans VS Code extension UI or `@beans` chat commands for all bean operations.
- Keep all your todo items inside the bean markdown under `## Todo`.
- Do not keep separate todo lists or scratchpads.
- Commit beans frequently to keep the issue tracker in sync.
- Use the correct branch naming convention and record branch and PR in bean frontmatter.
- When closing a bean, add a summary or reason for scrapping.

---

## 7. Extension-Specific Notes

- The extension auto-detects Ollama at `http://localhost:11434` by default.
- Use VS Code settings to configure Ollama host, models, and completions.
- For inline code completions, configure `ollama.completionModel` and toggle `ollama.enableInlineCompletions`.
- Use the Ollama sidebar for model lifecycle management (pull, run, stop, delete).
- Manage modelfiles with the dedicated Modelfile Manager sidebar.
- Use the command palette commands like `Ollama: Build Modelfile` to build custom models.
- Leverage streaming support for real-time response in chat.

---

## 8. Debugging and Testing

- Launch the extension in VS Code Extension Development Host with **F5**.
- Use the provided test suites:

- Unit tests with Vitest
- Extension integration tests
- Integration tests with pulled models

- Coverage target: 85% or higher.

---

## 9. Resources

- Ollama main repo: https://github.com/ollama/ollama
- Ollama Model Library: https://ollama.ai/library
- Ollama API Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
- Ollama Modelfile Docs: https://github.com/ollama/ollama/blob/main/docs/modelfile.md
- VS Code Language Model API: https://code.visualstudio.com/api/references/vscode-api#LanguageModelsAPI

---

## Summary

- **Always start with a bean and branch.**
- **Use Beans extension or MCP for all issue management.**
- **Run tasks via the Taskfile for consistency.**
- **Keep the bean todo checklist updated and commit often.**
- **Test, lint, format, and build before pushing changes.**
- **Follow branch naming and commit bean metadata.**
- **Use VS Code settings and extension UI for Ollama integration features.**

---

If you need further assistance, invoke the `@beans` chat participant or consult the Beans extension documentation.

Happy coding! 🚀
