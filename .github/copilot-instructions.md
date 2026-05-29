# GitHub Copilot Instructions for Agent: Visual Studio Code Extension Integrating Ollama into GitHub Copilot Chat

Welcome! This document guides you through the recommended workflows, conventions, and tooling when working on the **Opilot** VS Code extension project. Follow these instructions strictly to ensure consistency, quality, and smooth collaboration.

---

## Before Starting Work

- **Create or switch to the correct branch before editing code.**
- Branch name format: `[type]/[short-title]` (e.g., `feat/add-ollama-integration`).

---

## Project Overview

You are working on the **Opilot** extension, which integrates Ollama models into GitHub Copilot Chat inside VS Code.

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

## Development Environment Setup

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

## Code Quality Standards

This project uses **Ultracite**, a zero-config preset built on **Biome** that enforces strict code quality standards through automated formatting and linting. The project has migrated from oxlint/oxfmt to Biome via Ultracite, so `check-formatting` and `format` tasks are no longer needed — `ultracite check` and `ultracite fix` cover both linting and formatting in a single command.

### Quick Reference

- **Lint and format code**: `pnpm dlx ultracite fix`
- **Check for issues**: `pnpm dlx ultracite check`
- **Diagnose setup**: `pnpm dlx ultracite doctor`

### Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

#### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

#### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

#### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

#### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

#### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

#### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

#### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

#### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

#### Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

### When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

## Task Execution Using Taskfile

Use the provided `Taskfile.yml` to run common commands. Run tasks with:

```bash
task <taskname>
```

### Common tasks

| Task Name          | Description                                | Usage Example             |
| ------------------ | ------------------------------------------ | ------------------------- |
| check-types        | Type checking                              | `task check-types`        |
| lint               | Run linter and formatting check            | `task lint`               |
| lint-fix           | Auto-fix lint and formatting issues        | `task lint-fix`           |
| compile            | Compile the extension                      | `task compile`            |
| unit-tests         | Run unit tests                             | `task unit-tests`         |
| unit-test-coverage | Unit tests with coverage                   | `task unit-test-coverage` |
| extension-tests    | Run VS Code extension tests                | `task extension-tests`    |
| integration-tests  | Run integration tests (pulls models first) | `task integration-tests`  |
| precommit          | Run pre-commit checks                      | `task precommit`          |
| release            | Release the extension                      | `task release`            |
| watch              | Watch source and recompile                 | `task watch`              |

---

## Code Contribution Workflow

1. **Create or switch to the correct branch.**
2. **Run pre-commit tasks before committing:**

   ```bash
   task precommit
   ```

3. **Test your changes thoroughly:**
   - Unit tests: `task unit-tests`
   - Extension tests: `task extension-tests`
   - Integration tests: `task integration-tests`

4. **Build the extension before release or PR:**

   ```bash
   task compile
   ```

5. **Push your branch and create a pull request.**

---

## Extension-Specific Notes

- The extension auto-detects Ollama at `http://localhost:11434` by default.
- Use VS Code settings to configure Ollama host, models, and completions.
- For inline code completions, configure `ollama.completionModel` and toggle `ollama.enableInlineCompletions`.
- Use the Ollama sidebar for model lifecycle management (pull, run, stop, delete).
- Manage modelfiles with the dedicated Modelfile Manager sidebar.
- Use the command palette commands like `Ollama: Build Modelfile` to build custom models.
- Leverage streaming support for real-time response in chat.

---

## Debugging and Testing

- Launch the extension in VS Code Extension Development Host with **F5**.
- Use the provided test suites:

  - Unit tests with Vitest
  - Extension integration tests
  - Integration tests with pulled models
- Coverage target: 85% or higher.

---

## Resources

- Ollama main repo: https://github.com/ollama/ollama
- Ollama Model Library: https://ollama.ai/library
- Ollama API Docs: https://github.com/ollama/ollama/blob/main/docs/api.md
- Ollama Modelfile Docs: https://github.com/ollama/ollama/blob/main/docs/modelfile.md
- VS Code Language Model API: https://code.visualstudio.com/api/references/vscode-api#LanguageModelsAPI

---

## Summary

- **Create or switch to a branch before coding.**
- **Run tasks via the Taskfile for consistency.**
- **Use Ultracite (Biome) for linting and formatting — `ultracite check` and `ultracite fix` handle both.**
- **Test, lint, and build before pushing changes.**
- **Follow branch naming conventions.**
- **Use VS Code settings and extension UI for Ollama integration features.**

---

Happy coding! 🚀
