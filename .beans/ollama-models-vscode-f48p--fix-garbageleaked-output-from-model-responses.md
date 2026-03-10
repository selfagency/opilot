---
# ollama-models-vscode-f48p
title: fix garbage/leaked output from model responses
status: completed
type: bug
priority: high
created_at: 2026-03-10T15:47:47Z
updated_at: 2026-03-10T15:56:10Z
---

## Problem

Models are returning garbage output — XML context tags, thinking tags, or other internal markup leaking through to the user-visible response in the chat UI.

## Investigation Areas

- `OUTPUT_SCRUB_TAG_NAMES` in `src/formatting.ts` — verify all tags that should be scrubbed are listed
- `sanitizeNonStreamingModelOutput()` — confirm it is called on all non-streaming response paths
- Streaming scrub path — confirm `scrubXmlContextTags` is applied to every streamed chunk/accumulation
- `formatXmlLikeResponseForDisplay` — check for cases where content leaks through
- Confirm both the `@ollama` participant path (`src/extension.ts`) and the Copilot Chat provider path (`src/provider.ts`) sanitise output consistently
- Check for any code paths that return raw model output without sanitisation

## Todo

- [ ] Reproduce the garbage output and identify which tags/content is leaking
- [ ] Audit all response paths in extension.ts and provider.ts for sanitisation coverage
- [ ] Verify OUTPUT_SCRUB_TAG_NAMES is complete
- [ ] Fix any missing sanitisation calls
- [ ] Add/update unit tests to cover the leaking cases
