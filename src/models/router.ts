import type { SpecTier } from "../spec/types";

export interface ModelRoute {
  modelId: string;
  modelName: string;
  provider: string;
  inputCostPer1M: number;
  outputCostPer1M: number;
  cacheReadCostPer1M: number;
  cacheWriteCostPer1M: number;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  rationale: string;
}

// Routes derived from agent/models.json (theclawbay provider).
// instant  → cheapest model for quick lookups and Q&A
// ambient  → mid-tier for standard implementation tasks
// explicit → best model for approved, high-stakes work
const ROUTES: Record<SpecTier, ModelRoute> = {
  instant: {
    modelId: "gemini-2.5-flash-lite",
    modelName: "Gemini 2.5 Flash Lite",
    provider: "theclawbay",
    inputCostPer1M: 0.10,
    outputCostPer1M: 0.40,
    cacheReadCostPer1M: 0.01,
    cacheWriteCostPer1M: 0.10,
    contextWindow: 272000,
    maxTokens: 65536,
    reasoning: true,
    rationale: "Quick lookup — ultra-cheap, no complex reasoning needed",
  },
  ambient: {
    modelId: "gpt-5.4-mini",
    modelName: "GPT-5.4 Mini",
    provider: "theclawbay",
    inputCostPer1M: 1.25,
    outputCostPer1M: 10.00,
    cacheReadCostPer1M: 0.125,
    cacheWriteCostPer1M: 1.25,
    contextWindow: 272000,
    maxTokens: 65536,
    reasoning: true,
    rationale: "Standard task — balanced cost and capability",
  },
  explicit: {
    modelId: "gpt-5.5",
    modelName: "GPT-5.5",
    provider: "theclawbay",
    inputCostPer1M: 5.00,
    outputCostPer1M: 30.00,
    cacheReadCostPer1M: 0.50,
    cacheWriteCostPer1M: 5.00,
    contextWindow: 272000,
    maxTokens: 65536,
    reasoning: true,
    rationale: "Approved complex task — full capability with reasoning",
  },
};

export function routeModel(tier: SpecTier): ModelRoute {
  return ROUTES[tier];
}

export function formatRouteStatus(route: ModelRoute): string {
  return `route:${route.modelId} ($${route.inputCostPer1M}/1M)`;
}

export function formatRouteNotice(tier: SpecTier, route: ModelRoute, switched: boolean): string {
  const prefix = switched ? "Switched to" : "Recommended:";
  return `${prefix} ${route.modelName} — ${route.rationale}`;
}
