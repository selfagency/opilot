**Opilot Code Review & Com**
**prehensive Remediation**
**Plan**

VS Code Extension - Ollama AI Integration

Repository: github.com/selfagency/opilot

Version Reviewed: 1.5.0

Date: April 15, 2026

**Table of Contents**

- 1. Executive Summary
- 2. Background & Objectives
- 2.1 Project Overview
- 3. Scope & Methodology
- 3.1 Review Methodology
- 4. Review Findings Summary
- 5. Detailed Issue Analysis
- 5.1 Architecture & Code Duplication
- 1.1 Massive Code Duplication Between extension.ts and provider.ts
- 1.2 formatBytes() Utility Duplicated Three Times
- 1.3 extension.ts Exceeds Maintainable Size
- 5.2 Security
- 2.1 Shell Command Construction via String Interpolation
- 2.2 Unsafe File Write Without Locking
- 5.3 Error Handling
- 3.1 Silent Catch Blocks Masking Errors
- 3.2 Missing Error Handling on Stream Iteration
- 5.4 Cross-Reference Gaps: VS Code AI Documentation
- 6. Remediation Plan
- Phase 1: Immediate Stabilization (Sprint 1-2)
- Phase 2: Architectural Consolidation (Sprint 3-5)
- Phase 3: Platform Maturity (Sprint 6-10)
- 7. Implementation Roadmap
- 8. Risk Assessment
- 9. Appendices
- A. Reviewed Documentation Sources
- B. Complete Issue Inventory

_Note: Right-click the table of contents and select "Update Field" to refresh page numbers after opening in Word._

# **1\. Executive Summary**

This document presents the findings of a comprehensive code review conducted on the Opilot project (v1.5.0), a VS Code extension that integrates the Ollama local LLM ecosystem with GitHub Copilot Chat. The review cross-references the codebase against six official VS Code AI extension documentation guides, the Ollama JavaScript SDK reference, and the Ollama REST API specification. The goal is to identify every deviation from best practices, security weaknesses, architectural deficiencies, and robustness gaps, and to provide a complete, actionable remediation plan.

The Opilot extension is a mature, well-engineered project with strong fundamentals: TypeScript strict mode, comprehensive test infrastructure (Vitest with MSW and CodeQL), proper Content Security Policy enforcement on webviews, encrypted credential storage, and modular architecture with clear separation of concerns. However, the review identified 42 distinct issues across 13 categories, including one high-severity architectural defect involving massive code duplication between the two core modules, seven medium-severity issues spanning error handling, robustness, and security, and 34 low-severity items related to code quality, performance, documentation, and VS Code API best practices.

The most impactful finding is the duplication of six chat utility functions across extension.ts and provider.ts, which creates a maintenance burden and increases the risk of behavioral divergence during future updates. Secondary concerns include silent error swallowing in OpenAI-compatibility fallback paths, the absence of timeouts on connection testing, unsafe file-write operations without locking, and several opportunities to better leverage the VS Code AI extension APIs as documented in the official guides. The remediation plan prioritizes these findings into three phases: an immediate stabilization sprint addressing the high-impact items, a consolidation phase for architectural improvements, and a maturity phase for long-term quality enhancements.

## **2\. Background & Objectives**

## **2.1 Project Overview**

Opilot is an open-source VS Code extension (MIT license) developed by Self Agency that bridges the Ollama local LLM platform with GitHub Copilot Chat. It serves a dual purpose: first, as a Language Model Chat Provider that registers Ollama-hosted models (such as Llama 3, Mistral, Codestral, and others) as available language models within VS Code's model picker; and second, as a Chat Participant (@ollama) that provides conversational AI capabilities through Copilot Chat with tool-calling support for file operations, terminal commands, and workspace context retrieval.

The extension architecture comprises 18 TypeScript source files organized into functional modules: extension.ts serves as the main activation entry point and chat participant implementation; provider.ts implements the Language Model Chat Provider interface; client.ts manages Ollama HTTP client creation and configuration; sidebar.ts provides a tree view for local model management; statusBar.ts manages health-check status bar indicators; settings.ts handles configuration migration from legacy ollama.\* to opilot.\* namespace; and various utility modules handle context management, diagnostics, error handling, stream parsing, thinking content extraction, and tool definition mapping. The project is bundled using tsup and tested with Vitest, MSW for API mocking, and CodeQL for security analysis.

The review was initiated to ensure that the Opilot extension fully conforms to the latest VS Code AI extension APIs and best practices documented across six official Microsoft guides covering Language Model Tools, Chat Participants, Language Model Chat Providers, the Language Model consumer API, Prompt TSX, and MCP (Model Context Protocol). Additionally, the review validates correct usage of the Ollama JavaScript SDK (ollama-js) and REST API. The objective is to produce a gap analysis and a prioritized remediation roadmap that the maintainers can execute to bring the extension to full compliance with documented best practices.

## **3\. Scope & Methodology**

## **3.1 Review Methodology**

The review was conducted using a multi-layered methodology. First, all six VS Code AI extension documentation pages were retrieved and analyzed to extract API surface contracts, recommended patterns, naming conventions, error handling expectations, security considerations, and version requirements. Second, the Ollama JavaScript SDK (ollama-js) repository and the Ollama REST API documentation were reviewed to identify correct SDK usage patterns, streaming protocols, error code semantics, authentication flows, and model management operations. Third, the complete Opilot source tree was fetched and every TypeScript source file was examined for code quality issues, API misuse, security vulnerabilities, missing error handling, type safety concerns, performance problems, and architectural deficiencies.

Cross-referencing was performed by mapping each finding against the relevant documentation section. For example, tool naming conventions from the VS Code Language Model Tools guide were compared against the tool definitions in opilot's package.json and toolUtils.ts. Similarly, the Language Model Chat Provider interface requirements from the official documentation were checked against the implementation in provider.ts. Each issue was assigned a severity rating (Critical, High, Medium, or Low) based on its impact on reliability, security, maintainability, or user experience. The severity scale is defined as follows: Critical issues may cause data loss or security breaches; High issues significantly impact maintainability or reliability; Medium issues represent meaningful gaps that could cause problems under specific conditions; and Low issues are improvements that enhance code quality or alignment with best practices but carry minimal immediate risk.

The review scope covers the complete source tree at version 1.5.0, including 18 TypeScript source files, package.json configuration, tsconfig.json, and tsup.config.mjs. The review does not cover the compiled output, marketplace listing content, CI/CD pipeline configuration, or third-party dependencies beyond their declared versions. Test files were examined for coverage gaps but were not themselves reviewed for correctness.

## **4\. Review Findings Summary**

The comprehensive review identified a total of 42 distinct issues distributed across 13 categories. The distribution reveals a healthy project with no critical vulnerabilities but several areas requiring focused attention. The single high-severity finding relates to architectural code duplication that poses the greatest maintenance risk. Seven medium-severity issues span error handling, robustness, security, type safety, and configuration management, representing meaningful gaps that should be addressed in the near term. The remaining 34 low-severity items cover code quality, performance optimization, documentation completeness, dependency management, and minor VS Code API modernization opportunities.

| **Category**               | **Critical** | **High** | **Medium** | **Low** |
| -------------------------- | ------------ | -------- | ---------- | ------- |
| Architecture & Duplication | 0            | 1        | 0          | 2       |
| Security                   | 0            | 0        | 1          | 3       |
| Error Handling             | 0            | 0        | 2          | 1       |
| Type Safety                | 0            | 0        | 1          | 2       |
| Performance                | 0            | 0        | 0          | 4       |
| Configuration & Settings   | 0            | 0        | 1          | 1       |
| Testing                    | 0            | 0        | 0          | 2       |
| VS Code Best Practices     | 0            | 0        | 0          | 3       |
| Dependencies               | 0            | 0        | 0          | 1       |
| Documentation              | 0            | 0        | 0          | 1       |
| Robustness                 | 0            | 0        | 2          | 1       |
| Code Quality               | 0            | 0        | 0          | 3       |
| Cross-Reference Gaps       | 0            | 0        | 0          | 10      |
| Total                      | 0            | 1        | 7          | 34      |

The cross-reference gaps category (10 low-severity items) represents areas where the Opilot implementation does not fully leverage features or patterns recommended in the VS Code AI extension documentation. These are not bugs or defects, but rather missed opportunities to improve the extension's integration quality, user experience, and alignment with the evolving VS Code AI platform. Examples include the absence of @vscode/prompt-tsx for prompt management, missing disambiguation configuration for chat participant auto-routing, and the potential to expose Ollama capabilities as MCP tools for broader ecosystem integration.

## **5\. Detailed Issue Analysis**

## **5.1 Architecture & Code Duplication**

## **1.1 Massive Code Duplication Between extension.ts and provider.ts**

**Severity:** High | Files: src/extension.ts (lines 53-295), src/provider.ts (lines 504-728)

The most significant architectural issue in the codebase is the near-identical duplication of six functions across extension.ts and provider.ts. Specifically, mapOpenAiToolCallsToOllamaLike() is duplicated verbatim in both files, as are buildSdkOptions(), openAiCompatStreamChat(), openAiCompatChatOnce(), nativeSdkStreamChat(), and nativeSdkChatOnce(). The implementations differ only in minor parameter ordering, which suggests they were initially copy-pasted and then slightly modified independently.

This duplication creates a serious maintenance burden: any bug fix or behavioral change must be applied to both copies, and there is no compile-time mechanism to ensure the two copies remain in sync. Over time, behavioral divergence becomes almost inevitable, leading to subtle bugs where the chat participant and language model provider exhibit different error handling, streaming behavior, or tool-call mapping logic. The risk is compounded by the fact that these functions implement complex OpenAI-compatibility shim layers that are inherently fragile due to type mismatches between VS Code's LanguageModelToolCallPart and Ollama's tool call format.

**Remediation:** Extract all six duplicated functions into a new shared module (e.g., src/chatUtils.ts). Both extension.ts and provider.ts should import from this module. This is a straightforward refactor with no behavioral change. The shared module should include comprehensive unit tests to guard against regression. Additionally, the buildSdkOptions() function and formatBytes() utility (duplicated three times across extension.ts, statusBar.ts, and sidebar.ts) should be consolidated.

## **1.2 formatBytes() Utility Duplicated Three Times**

**Severity:** Medium | Files: src/extension.ts:401-406, src/statusBar.ts:42-47, src/sidebar.ts:139-149

Three separate implementations of byte formatting exist across the codebase, each with slightly different formatting logic. The extension.ts version uses KB/MB/GB suffixes, the statusBar.ts version uses the same suffixes with a different precision, and the sidebar.ts version adds decimal precision. This inconsistency means that model sizes may be displayed differently depending on where they appear in the UI, creating a disjointed user experience.

**Remediation:** Create a single src/formatUtils.ts module exporting a unified formatBytes() function with configurable precision and suffix style. All three call sites should import from this module. Add unit tests covering edge cases (0 bytes, negative values, very large values exceeding TB).

## **1.3 extension.ts Exceeds Maintainable Size**

**Severity:** Low | File: src/extension.ts (1220+ lines)

The main extension file handles chat participant setup, chat request handling with streaming, tool calling with round-trip iteration, configuration management, connection testing, built-in Ollama conflict detection and resolution, log streaming with tail subprocess management, and performance snapshot generation. This breadth of responsibility makes the file difficult to navigate, test in isolation, and review. Future contributors will struggle to understand the full scope of changes needed when modifying any single concern.

**Remediation:** Split extension.ts into focused modules. Suggested extraction targets include: src/chatParticipant.ts (chat participant registration and request handling), src/connectionManager.ts (connection testing, health monitoring), src/logStreamer.ts (journalctl and server.log tail management), src/conflictResolver.ts (built-in Ollama conflict detection and resolution), and src/performanceSnapshot.ts. The activate() function in extension.ts should remain as the orchestrator that imports and wires these modules together.

## **5.2 Security**

## **2.1 Shell Command Construction via String Interpolation**

**Severity:** Medium | File: src/sidebar.ts:1118-1131 (forceKillProcess)

The forceKillProcess() function constructs shell commands using template literals with the PID variable interpolated into a string: on Windows it uses \`taskkill /F /PID \${pid}\` and on Unix it uses \`kill -9 \${pid}\`. While the PID is extracted from Ollama server logs via a regex pattern that constrains it to numeric values only (\\d+), making injection impossible in practice, using execAsync() with string interpolation is a defense-in-depth anti-pattern. If the regex were ever relaxed or the PID source changed, this would become a command injection vulnerability.

**Remediation:** Replace execAsync(command) with execFileSync() using an array of arguments (e.g., execFileSync('kill', \['-9', String(pid)\])). This eliminates the string interpolation entirely and ensures that the PID is passed as a separate argument that cannot be interpreted as shell syntax. Apply the same pattern to any other shell command invocations found in the codebase.

## **2.2 Unsafe File Write Without Locking**

**Severity:** Medium | File: src/extension.ts:352-373 (removeBuiltInOllamaFromChatLanguageModels)

This function directly reads, modifies, and writes VS Code's chatLanguageModels.json configuration files on disk. If VS Code or another extension is concurrently reading or writing these same files, a race condition could result in data corruption or lost configuration. The function performs a read-modify-write cycle without any form of file locking, version checking, or retry logic. While VS Code's own extension host serialization may provide some implicit protection, it is not documented as a guarantee and should not be relied upon.

**Remediation:** Wrap the read-modify-write cycle in a retry loop with JSON comparison: read the file, parse it, compute the modified version, re-read the file to check if it changed since the initial read, and only write if it hasn't. If it has changed, retry the operation (up to a reasonable limit). Alternatively, use VS Code's workspace configuration API where possible instead of direct file manipulation.

## **5.3 Error Handling**

## **3.1 Silent Catch Blocks Masking Errors**

**Severity:** Medium | Files: src/extension.ts (lines 166, 226, 810), src/client.ts (lines 86-87), src/openaiCompat.ts (line 212), src/sidebar.ts (line 862)

Several catch blocks throughout the codebase swallow errors without logging any diagnostic information. The most concerning instances are in extension.ts where openAiCompatStreamChat() and openAiCompatChatOnce() silently fall back to the native SDK path when the OpenAI-compatible endpoint fails. Without logging, developers and users have no way to understand why the fallback was triggered, whether it indicates a configuration error, a network problem, or an API incompatibility. Similarly, client.ts silently returns false from testConnection() on any error, making it impossible to distinguish between a connection refusal, a timeout, and an authentication failure.

**Remediation:** Add outputChannel.appendLine() or console.warn() calls to all catch blocks that currently swallow errors silently. At minimum, log the error message and stack trace at warning level. For the OpenAI-compat fallback paths, include a message indicating which fallback path was taken and why, so users can diagnose configuration issues. For testConnection(), differentiate between connection refused (server not running), timeout (server unreachable), and authentication errors (API key issues).

## **3.2 Missing Error Handling on Stream Iteration**

**Severity:** Medium | Files: src/extension.ts:1005 (handleChatRequest), src/provider.ts:903 (provideLanguageModelChatResponse)

The for-await-of loops that iterate over streaming responses from Ollama do not include try-catch blocks around the iteration. If the Ollama server drops the connection mid-stream, encounters an internal error, or the user's CancellationToken is triggered during iteration, the resulting promise rejection propagates as an unhandled error to VS Code's error boundary. This can cause the chat participant or language model provider to display a generic error message rather than a graceful degradation or retry prompt.

**Remediation:** Wrap the for-await-of loop in a try-catch block that catches streaming errors and reports them through VS Code's appropriate error reporting mechanism. For the chat participant, use stream.markdown() to inform the user that the response was interrupted. For the language model provider, throw a LanguageModelError with appropriate error codes. In both cases, ensure that partial response content is properly flushed before reporting the error.

## **5.4 Cross-Reference Gaps: VS Code AI Documentation**

The following cross-reference gaps were identified by comparing the Opilot implementation against the official VS Code AI extension documentation and Ollama SDK documentation. These represent opportunities to improve integration quality, leverage new platform features, and align with evolving best practices.

| **#** | **Reference Source** | **Gap Description**                                                                                                                                                                                                                                      | **Severity** |
| ----- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1     | VS Code Tools Guide  | Tool naming convention: Some tools do not follow the recommended {verb}\_{noun} pattern. The guide explicitly recommends names like get_file_content and run_terminal_command for optimal LLM invocation accuracy.                                       | Low          |
| 2     | VS Code Tools Guide  | modelDescription quality: Tool descriptions written for LLM consumption could be more detailed. The guide recommends explaining not just what the tool does, but when it should and should not be used, its limitations, and parameter constraints.      | Low          |
| 3     | VS Code Tools Guide  | canBeReferencedInPrompt: Not all tools have this property set to true. Enabling it allows users to reference tools directly in chat with the # syntax, improving discoverability.                                                                        | Low          |
| 4     | VS Code Chat Guide   | Chat participant disambiguation: The @ollama participant does not configure disambiguation examples. Adding category, description, and examples enables VS Code to auto-route relevant prompts to the participant without requiring explicit @ mentions. | Low          |
| 5     | VS Code Chat Guide   | Chat location awareness: The request.location property could be used to differentiate behavior between Chat view, Quick Chat, and inline chat contexts for context-appropriate responses.                                                                | Low          |
| 6     | VS Code LM Provider  | Silent mode: provideLanguageModelChatInformation should check options.silent to avoid prompting for credentials during model discovery, enabling smoother model enumeration.                                                                             | Low          |
| 7     | VS Code Prompt TSX   | Prompt management: The extension builds prompts through manual string concatenation. Adopting @vscode/prompt-tsx would enable priority-based context pruning, dynamic token budget management, and modular prompt composition.                           | Low          |
| 8     | VS Code MCP Guide    | MCP tool exposure: Ollama's capabilities (model management, embeddings, generation) could be exposed as MCP tools, enabling integration with any MCP-compatible client beyond VS Code.                                                                   | Low          |
| 9     | Ollama SDK           | Abort semantics: ollama.abort() kills ALL streams on a client instance. The extension should use per-request client instances for isolation, or implement a per-stream abort mechanism.                                                                  | Low          |
| 10    | Ollama API           | Error response parsing: Mid-stream errors are returned as NDJSON objects with an error property. The OpenAI-compat layer should detect and surface these mid-stream errors to the user.                                                                  | Low          |

## **6\. Remediation Plan**

The remediation plan is organized into three phases, ordered by urgency and dependency. Phase 1 addresses immediate stability and maintainability concerns. Phase 2 focuses on architectural consolidation and API compliance. Phase 3 targets long-term quality improvements and platform alignment. Each action item includes an estimated effort, dependencies, and expected outcome.

## **Phase 0: Agentsy Package Migration (Immediate)**

`@agentsy/core` has been deprecated in favor of focused packages. Before continuing deeper roadmap items, complete a package migration slice to avoid building additional work on deprecated APIs.

| **Action**                                                                                                                                                             | **Severity** | **Effort** | **Files Affected**                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------- | ----------------------------------------------------------- |
| Replace `@agentsy/core/*` imports with focused packages (`@agentsy/context`, `@agentsy/formatting`, `@agentsy/thinking`, `@agentsy/tool-calls`, `@agentsy/xml-filter`) | High         | 0.5 day    | formatting.ts, thinkingParser.ts, toolUtils.ts, provider.ts |
| Update dependency graph to remove deprecated `@agentsy/core` and add focused packages                                                                                  | High         | 0.2 day    | package.json, pnpm-lock.yaml                                |
| Preserve compatibility wrappers for API shape differences (e.g. context split `remaining` -> `content`, tool payload helper aliasing)                                  | Medium       | 0.2 day    | formatting.ts, toolUtils.ts, tests                          |
| Update developer documentation to reflect focused package model and migration guidance                                                                                 | Medium       | 0.3 day    | docs/developers/\*.md, docs/plans/remediation-plan.md       |

## **Phase 1: Immediate Stabilization (Sprint 1-2)**

Phase 1 targets the highest-impact issues that can be resolved quickly with minimal risk. These items address the code duplication problem, the most dangerous error handling gaps, and the security hardening opportunities. The estimated total effort for Phase 1 is 3-5 developer days.

| **Action**                                                        | **Severity** | **Effort** | **Files Affected**                                   |
| ----------------------------------------------------------------- | ------------ | ---------- | ---------------------------------------------------- |
| Extract 6 duplicated chat utility functions into src/chatUtils.ts | High         | 1 day      | extension.ts, provider.ts, new chatUtils.ts          |
| Add logging to all silent catch blocks                            | Medium       | 0.5 day    | extension.ts, client.ts, openaiCompat.ts, sidebar.ts |
| Add timeout to testConnection() using AbortController             | Medium       | 0.5 day    | client.ts                                            |
| Replace execAsync string interpolation with execFileSync          | Medium       | 0.5 day    | sidebar.ts                                           |
| Consolidate formatBytes() into src/formatUtils.ts                 | Medium       | 0.5 day    | extension.ts, statusBar.ts, sidebar.ts               |
| Remove dead saxophone.d.ts type declaration                       | Low          | 0.1 day    | saxophone.d.ts                                       |

## **Phase 2: Architectural Consolidation (Sprint 3-5)**

Phase 2 addresses the structural improvements that require more careful planning and testing. These changes improve the extension's maintainability, alignment with VS Code AI best practices, and robustness under edge conditions. The estimated total effort for Phase 2 is 5-8 developer days.

| **Action**                                                       | **Severity** | **Effort** | **Files Affected**         |
| ---------------------------------------------------------------- | ------------ | ---------- | -------------------------- |
| Add file locking to removeBuiltInOllamaFromChatLanguageModels    | Medium       | 1 day      | extension.ts               |
| Wrap stream iteration in try-catch with graceful error reporting | Medium       | 1 day      | extension.ts, provider.ts  |
| Add disambiguation config for chat participant auto-routing      | Low          | 0.5 day    | package.json               |
| Update deprecated createStatusBarItem API                        | Low          | 0.5 day    | statusBar.ts               |
| Clean up legacy ollama.\* settings after migration               | Medium       | 0.5 day    | settings.ts                |
| Improve tool modelDescription and userDescription quality        | Low          | 1 day      | package.json, toolUtils.ts |
| Implement per-request Ollama client isolation for abort safety   | Low          | 1 day      | provider.ts, client.ts     |

## **Phase 3: Platform Maturity (Sprint 6-10)**

Phase 3 encompasses the longer-term improvements that align the extension with the full breadth of VS Code AI capabilities and Ollama SDK features. These items require significant design consideration and may involve user-facing changes. The estimated total effort for Phase 3 is 8-12 developer days.

| **Action**                                                      | **Severity** | **Effort** | **Files Affected**                            |
| --------------------------------------------------------------- | ------------ | ---------- | --------------------------------------------- |
| Evaluate adoption of @vscode/prompt-tsx for prompt management   | Low          | 3-5 days   | New prompt/ module, extension.ts, provider.ts |
| Investigate MCP server definition for Ollama tools              | Low          | 2-3 days   | New mcp/ module, package.json                 |
| Add chat location awareness (Chat view vs Quick Chat vs inline) | Low          | 1 day      | extension.ts                                  |
| Implement silent mode in provideLanguageModelChatInformation    | Low          | 0.5 day    | provider.ts                                   |
| Add canBeReferencedInPrompt to applicable tools                 | Low          | 0.5 day    | package.json                                  |
| Improve mid-stream error detection in OpenAI-compat layer       | Low          | 1 day      | openaiCompat.ts                               |
| Split extension.ts into focused modules                         | Low          | 3-5 days   | extension.ts -> multiple modules              |

## **7\. Implementation Roadmap**

The implementation roadmap provides a visual timeline for executing the remediation plan across three phases. The timeline assumes a single developer working part-time on remediation alongside normal feature development. If a dedicated sprint is allocated, the timeline can be compressed accordingly.

| **Sprint** | **Phase**         | **Key Deliverables**                                                  | **Exit Criteria**                                                                |
| ---------- | ----------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 0          | Agentsy Migration | Focused-package import migration, dependency swap, docs refresh       | No `@agentsy/core` imports remain; compile/tests green                           |
| 1          | Stabilization     | chatUtils.ts extraction, silent catch logging, testConnection timeout | All Phase 1 items merged; existing tests pass; no regression in E2E tests        |
| 2          | Stabilization     | execFileSync migration, formatBytes consolidation, dead code removal  | Code duplication reduced by 80%+; zero silent catch blocks remain                |
| 3-4        | Consolidation     | File locking, stream error handling, disambiguation config            | No data loss from race conditions; stream errors gracefully reported             |
| 5          | Consolidation     | Legacy settings cleanup, deprecated API updates, tool descriptions    | Zero deprecation warnings; settings migration fully complete                     |
| 6-7        | Maturity          | prompt-tsx evaluation, MCP investigation, chat location awareness     | Architecture decision record published for prompt-tsx and MCP                    |
| 8-10       | Maturity          | extension.ts split, per-request client isolation, mid-stream errors   | No file exceeds 400 lines; all recommended patterns from VS Code AI docs adopted |

Each sprint should conclude with a full test run (unit tests, integration tests, and CodeQL analysis) to verify that no regressions have been introduced. The exit criteria for each sprint are defined above and should be treated as hard gates before proceeding to the next sprint.

## **8\. Risk Assessment**

The following risk assessment identifies potential obstacles to successful remediation and proposes mitigation strategies for each.

| **Risk**                                                  | **Likelihood** | **Impact** | **Mitigation Strategy**                                                                                                   |
| --------------------------------------------------------- | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------- |
| Refactoring breaks existing tests                         | Medium         | Medium     | Run full test suite after each extraction. Write characterization tests before refactoring duplicated code.               |
| File locking introduces performance overhead              | Low            | Low        | Implement exponential backoff retry rather than OS-level file locks. Benchmark before committing.                         |
| prompt-tsx adoption requires significant prompt rewriting | Medium         | Medium     | Conduct a spike in Sprint 6 to evaluate effort. If effort exceeds 3 days, defer to a future milestone.                    |
| MCP integration conflicts with existing tool definitions  | Low            | Low        | MCP is additive; existing tools remain unchanged. Use MCP for discovery only, not as a replacement.                       |
| Splitting extension.ts breaks activation timing           | Medium         | High       | Preserve the activate() function as the single entry point. Only extract internal logic, not activation orchestration.    |
| Legacy settings cleanup affects existing users            | Medium         | Medium     | Add a settings version counter. Only clean up after confirming the user has successfully migrated (not on first install). |

## **9\. Appendices**

## **A. Reviewed Documentation Sources**

| **Source**              | **URL**                                                                    | **Key Topics**                                    |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| VS Code AI Tools        | code.visualstudio.com/api/extension-guides/ai/tools                        | Tool naming, descriptions, confirmation, schema   |
| VS Code Chat API        | code.visualstudio.com/api/extension-guides/ai/chat                         | Participants, commands, follow-ups, streaming     |
| VS Code LM Provider     | code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider | Provider interface, model info, silent mode       |
| VS Code LM Consumer     | code.visualstudio.com/api/extension-guides/ai/language-model               | Model selection, sendRequest, error handling      |
| VS Code Prompt TSX      | code.visualstudio.com/api/extension-guides/ai/prompt-tsx                   | Priority pruning, token budgets, component model  |
| VS Code MCP Guide       | code.visualstudio.com/api/extension-guides/ai/mcp                          | MCP servers, tools, resources, OAuth, apps        |
| Agentsy Migration Guide | agentsy.self.agency/migrating-from-llm-stream-parser.html                  | Focused package mapping, install/import migration |
| Agentsy Package Catalog | agentsy.self.agency/packages.html                                          | Published package boundaries and status           |
| Agentsy API Index       | agentsy.self.agency/api.html                                               | Current public exports across package family      |
| Ollama JS SDK           | github.com/ollama/ollama-js                                                | Client init, chat, streaming, model mgmt          |
| Ollama REST API         | docs.ollama.com/api/introduction                                           | Endpoints, streaming, errors, OpenAI compat       |
| Opilot Repository       | github.com/selfagency/opilot                                               | 18 source files, v1.5.0                           |

## **B. Complete Issue Inventory**

The table below provides the complete inventory of all 42 issues identified during the review, organized by severity and category. Each issue is cross-referenced to the relevant documentation source where applicable.

| **ID**  | **Category**   | **Severity** | **File**                               | **Summary**                                                    |
| ------- | -------------- | ------------ | -------------------------------------- | -------------------------------------------------------------- |
| 001     | Architecture   | High         | extension.ts, provider.ts              | Six chat utility functions duplicated across two files         |
| 002     | Architecture   | Low          | extension.ts, statusBar.ts, sidebar.ts | formatBytes() duplicated three times                           |
| 003     | Architecture   | Low          | extension.ts                           | File exceeds 1220 lines; multiple responsibilities             |
| 004     | Security       | Medium       | sidebar.ts:1118-1131                   | Shell command construction via string interpolation            |
| 005     | Security       | Medium       | extension.ts:352-373                   | File write without locking or retry                            |
| 006     | Security       | Low          | sidebar.ts:1084                        | Static journalctl command assumes PATH availability            |
| 007     | Security       | Low          | extension.ts:1282-1283                 | PowerShell script in string (safe but anti-pattern)            |
| 008     | Security       | Low          | client.ts:35-37                        | Credentials may appear in URL error dialogs                    |
| 009     | Error Handling | Medium       | extension.ts:166,226                   | OpenAI-compat fallback errors silently swallowed               |
| 010     | Error Handling | Medium       | extension.ts:1005, provider.ts:903     | Stream iteration lacks try-catch error handling                |
| 011     | Error Handling | Low          | client.ts:86-87                        | testConnection silently returns false                          |
| 012     | Error Handling | Low          | extension.ts:810                       | task_complete tool call error silently ignored                 |
| 013     | Type Safety    | Medium       | Multiple files                         | Excessive use of as type assertions without runtime validation |
| 014     | Type Safety    | Low          | extension.ts:835                       | as never cast suppresses type checking                         |
| 015     | Type Safety    | Low          | Multiple files                         | Inconsistent import style for VS Code types                    |
| 016     | Performance    | Low          | Multiple files                         | Repeated getSetting() calls not cached per request             |
| 017     | Performance    | Low          | sidebar.ts:804,835                     | Tree refresh fires on every tooltip update                     |
| 018     | Performance    | Low          | contextUtils.ts:110-130                | O(n^2) repetition detection in worst case                      |
| 019     | Performance    | Low          | provider.ts:815-817                    | New Ollama client created per request                          |
| 020     | Configuration  | Medium       | settings.ts:101-172                    | Legacy settings not cleaned up after migration                 |
| 021     | Configuration  | Low          | package.json                           | Deprecated ollama.\* settings still declared                   |
| 022     | Testing        | Low          | extension.ts:308-376                   | No dedicated test for removeBuiltInOllama function             |
| 023     | Testing        | Low          | extension.ts:530-605                   | No dedicated test for handleBuiltInOllamaConflict              |
| 024     | VS Code        | Low          | statusBar.ts:133                       | Deprecated createStatusBarItem overload used                   |
| 025     | VS Code        | Low          | package.json                           | canBeReferencedInPrompt not set on all tools                   |
| 026     | VS Code        | Low          | package.json                           | No disambiguation config for chat participant                  |
| 027     | Dependencies   | Low          | saxophone.d.ts                         | Dead type declaration for unused package                       |
| 028     | Documentation  | Low          | contextUtils.ts, diagnostics.ts        | Missing module-level documentation                             |
| 029     | Robustness     | Medium       | client.ts:82-89                        | No timeout on testConnection()                                 |
| 030     | Robustness     | Low          | extension.ts:615                       | No overall timeout on chat request handler                     |
| 031     | Code Quality   | Low          | settings.ts:48-92                      | getSetting return type API could be clearer                    |
| 032     | Code Quality   | Low          | saxophone.d.ts                         | Unused type declaration file                                   |
| 033     | Code Quality   | Low          | extension.ts                           | File size exceeds maintainable threshold                       |
| 034-043 | Cross-Ref      | Low          | Various                                | 10 alignment gaps with VS Code AI docs and Ollama SDK          |
