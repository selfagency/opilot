---
# opilot-haqc
title: 'Performance: optimize XML streaming parser in formatting.ts'
status: completed
type: task
priority: low
created_at: 2026-03-08T16:41:32Z
updated_at: 2026-03-08T17:45:44Z
id: opilot-haqc
---

Profile and improve the performance of the SAX-based XML response formatter in `src/formatting.ts` to reduce overhead for large streamed responses.

## Context

`src/formatting.ts` uses a SAX parser (saxophone) to scan streaming responses for XML-like tags and reformat them for display. For very large responses the parser may buffer more data than necessary and re-process already-emitted content. There may also be opportunities to avoid repeated regex execution per chunk.

## Todo

- [ ] Profile `formatXmlLikeResponseForDisplay` and `XmlStreamFilter` with a large input to establish a baseline
- [ ] Identify hotspots: unnecessary buffer copies, repeated regex, or avoidable DOM-like walks
- [ ] Implement targeted optimizations without changing public API or test expectations
- [ ] Add a benchmark or size-threshold assertion to prevent regressions
- [ ] Run `task unit-tests` to confirm all existing tests still pass

## Files

- `src/formatting.ts`
- `src/formatting.test.ts` (benchmark / regression test)
