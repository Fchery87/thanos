// Mirrors pi-ai's ThinkingLevel: "off" is expressed by omitting `reasoning`,
// so ":off" suffixes parse to thinking=undefined rather than a level.
export type ThinkingLevel = "minimal" | "low" | "medium" | "high" | "xhigh";

const THINKING_LEVELS = new Set<string>(["minimal", "low", "medium", "high", "xhigh"]);

export interface EvaluatorOverride {
  model: string;
  fallbackModels?: string[];
}

export interface ModelLike {
  provider: string;
  id: string;
}

export interface ParsedModelRef {
  provider: string;
  id: string;
  thinking: ThinkingLevel | undefined;
}

/** Parse "provider/model[:thinking]"; unknown thinking levels are dropped. */
export function parseModelRef(ref: string): ParsedModelRef | undefined {
  const slash = ref.indexOf("/");
  if (slash <= 0) return undefined;
  const provider = ref.slice(0, slash);
  let id = ref.slice(slash + 1);
  let thinking: ThinkingLevel | undefined;
  const colon = id.lastIndexOf(":");
  if (colon > 0) {
    const level = id.slice(colon + 1);
    thinking = THINKING_LEVELS.has(level) ? (level as ThinkingLevel) : undefined;
    id = id.slice(0, colon);
  }
  if (!id) return undefined;
  return { provider, id, thinking };
}

export interface RequestAuthRegistryLike<M> {
  getApiKeyAndHeaders(model: M): Promise<
    { ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }
  >;
}

/**
 * Resolve request auth for an out-of-band evaluator completion through the
 * model registry — the same path pi's own requests use, covering auth.json
 * keys, $ENV references in models.json, and OAuth. Calling completeSimple
 * without this only works for builtin providers with well-known env keys;
 * every models.json-configured provider fails with "No API key".
 */
export async function resolveEvaluatorAuth<M extends ModelLike>(
  registry: RequestAuthRegistryLike<M>,
  model: M,
): Promise<{ apiKey?: string; headers?: Record<string, string> }> {
  const auth = await registry.getApiKeyAndHeaders(model);
  if (auth.ok === false) {
    throw new Error(`cannot resolve auth for ${model.provider}/${model.id}: ${auth.error}`);
  }
  return { apiKey: auth.apiKey, headers: auth.headers };
}

/**
 * Resolve the /goal evaluator's model from a routing override, walking
 * primary then fallbacks and returning the first registered+authed match.
 * Returns undefined when nothing is usable so the caller can fall back to
 * the session model — the same degradation subagents get while routing is
 * toggled off.
 */
export function pickEvaluatorModel<M extends ModelLike>(
  override: EvaluatorOverride,
  models: readonly M[],
  hasAuth: (model: M) => boolean,
): { model: M; thinking: ThinkingLevel | undefined } | undefined {
  for (const ref of [override.model, ...(override.fallbackModels ?? [])]) {
    const parsed = parseModelRef(ref);
    if (!parsed) continue;
    const match = models.find((m) => m.provider === parsed.provider && m.id === parsed.id);
    if (match && hasAuth(match)) return { model: match, thinking: parsed.thinking };
  }
  return undefined;
}
