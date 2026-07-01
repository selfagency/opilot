<!-- Context: project-intelligence/technical | Priority: critical | Version: 2.0 | Updated: 2026-07-01 -->

# Technical Domain

**Purpose**: Tech stack, architecture, and development patterns for the Opilot VS Code extension.
**Last Updated**: 2026-07-01

## Quick Reference

**Update Triggers**: Tech stack changes | New patterns | Architecture decisions
**Audience**: Developers, AI agents

## Primary Stack (summary)

- Framework: VS Code Extension API (recommended minimum ^1.109.0)
- Language: TypeScript (ES2024), strict mode enabled
- Runtime: Node.js 20+
- Package Manager: pnpm (workspaces)
- Testing: Vitest
- Linting/Formatting: Biome (Ultracite)
- Build: tsup

## Key Patterns (MVI: short concept + 3–5 points + example)

### 1) Chat Provider (API Pattern)

Concept: LanguageModelChatProvider implementation for streaming LLM responses and tool integration.
Key points:

- Implements `LanguageModelChatProvider` interface
- Streams tokens/events via an emitter
- Supports LanguageModelToolCall parts for tool integrations
- Centralized error reporting via `reportError()`
Example:

```typescript
export class OllamaChatModelProvider implements LanguageModelChatProvider {
  async provideLanguageModelChatResponse(messages, options, token) {
    // Validate inputs, open streaming connection to Ollama
    // Emit incremental response chunks
    // Handle cancellations via token
  }
}
```

### 2) Sidebar Provider (Component Pattern)

Concept: TreeDataProvider-based sidebar for model lifecycle and local/cloud listings.
Key points:

- Exposes a `registerSidebar(context, client, logChannel)` helper
- Uses `TreeDataProvider` + `EventEmitter` for refresh
- Registers disposables on `context.subscriptions`
Example:

```typescript
export function registerSidebar(context, client, logChannel) {
  // create TreeDataProvider, register commands, push disposables
}
```

### 3) Extension Activation

Concept: Single activation entrypoint registers providers, commands, and completions with graceful failure handling.
Key points:

- `activate(context)` registers all providers and commands
- Use `context.subscriptions.push(...)` for cleanup
- Test connections on startup and degrade gracefully
Example:

```typescript
export async function activate(context) {
  // register providers, fallback handlers, feature flags
}
```

### 4) Naming Conventions

Concept: Consistent cross-project naming for files, symbols, and config.
Key points:

- Files: `kebab-case` (e.g., `error-handler.ts`)
- Classes/Providers/Interfaces: `PascalCase`
- Functions: `camelCase`
- Constants: `UPPER_SNAKE`

### 5) Code Standards

Concept: Type-safe, explicit TypeScript patterns and predictable exports.
Key points:

- `strict` TypeScript settings
- Prefer named exports; avoid `export default`
- Use `import type` for types
- Prefer `async/await`; handle errors with `reportError()`
- Co-locate `.test.ts` files with implementation

### 6) Security Requirements

Concept: Protect secrets, validate inputs, and centralize error handling.
Key points:

- No hardcoded secrets; use VS Code settings or secure storage
- Validate connections via `testConnection()` before use
- Sanitize error messages through `reportError()` before surface

## 📂 Codebase References

- Implementation: `src/provider.ts` — Chat provider (API pattern)
- Implementation: `src/sidebar.ts` — Sidebar view (component pattern)
- Implementation: `src/extension.ts` — Extension activation entry point
- Implementation: `src/error-handler.ts` — Error handling
- Implementation: `src/settings.ts` — Settings/configuration
- Config: `tsconfig.json`, `biome.json`, `package.json`

## Related Files

- `navigation.md` — Project intelligence index
- `AGENTS.md` — Agent instructions
