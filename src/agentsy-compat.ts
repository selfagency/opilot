// Compatibility adapters between legacy @agentsy/core shapes and new @agentsy/* packages
// Keep minimal mappings required by Opilot until full migration is complete.

export type LegacyContext = {
  remaining?: string;
  metadata?: Record<string, unknown>;
};

export type NewContext = {
  content: string;
  meta?: Record<string, unknown>;
};

export function mapLegacyContextToNew(ctx: LegacyContext | string | undefined): NewContext {
  if (!ctx) return { content: '' };
  if (typeof ctx === 'string') return { content: ctx };
  const content = ctx.remaining ?? '';
  return { content, meta: ctx.metadata };
}

export type LegacyToolPayload = Record<string, unknown>;
export type NewToolPayload = Record<string, unknown>;

export function mapToolPayload(payload: LegacyToolPayload): NewToolPayload {
  // Identity mapping by default. Add known field renames here.
  return { ...payload };
}

// Small helper to adapt thinking parts (string-based) — pass-through for now.
export function normalizeThinkingPart(part: string | { text?: string } | undefined): string {
  if (!part) return '';
  if (typeof part === 'string') return part;
  return part.text ?? '';
}

export default {
  mapLegacyContextToNew,
  mapToolPayload,
  normalizeThinkingPart,
};
