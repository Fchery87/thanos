// Shared helpers for tests that resolve a "provider/model[:thinking]" reference
// against agent/models.example.json's catalog shape. Used by settings.test.ts
// and roster-contract.test.ts, which both validate the same subagent
// model-override-resolves-to-a-real-catalog-entry contract.

export interface ModelCatalog {
  providers: Record<string, { models?: { id: string; input?: string[] }[] }>;
}

export function splitModelRef(ref: string): { provider: string; model: string } {
  const [withoutThinking] = ref.split(":");
  const [provider, model] = withoutThinking?.split("/") ?? [];
  if (!provider || !model) throw new Error(`Invalid model reference: ${ref}`);
  return { provider, model };
}

export function modelForRef(catalog: ModelCatalog, ref: string): { id: string; input?: string[] } | undefined {
  const { provider, model } = splitModelRef(ref);
  return catalog.providers[provider]?.models?.find((entry) => entry.id === model);
}
