import { completeSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadEvaluatorOverride } from "../goal/load-settings";
import { pickEvaluatorModel, resolveEvaluatorAuth } from "../goal/evaluator-model";
import { buildContractExtractionPrompt, parseContractResponse } from "./extractor-prompt";
import type { SpecTier } from "./types";

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_ROLE = "evaluator";

export interface SpecExtractionSettings {
  /** Off switch, per project, without a code change. Defaults to on. */
  extraction: boolean;
  /** Routing role to resolve a model from; falls back to the session model. */
  extractorRole: string;
  timeoutMs: number;
}

function settingsPath(): string {
  const home = process.env.HOME;
  return home ? join(home, ".pi", "agent", "settings.json") : join(process.cwd(), "agent", "settings.json");
}

/** Best-effort read of the `spec` block from settings.json; defaults on any error. */
export function loadSpecSettings(): SpecExtractionSettings {
  const defaults: SpecExtractionSettings = {
    extraction: true,
    extractorRole: DEFAULT_ROLE,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  try {
    const raw = JSON.parse(readFileSync(settingsPath(), "utf-8")) as { spec?: Partial<SpecExtractionSettings> };
    const spec = raw.spec;
    if (!spec) return defaults;
    return {
      extraction: typeof spec.extraction === "boolean" ? spec.extraction : defaults.extraction,
      extractorRole: typeof spec.extractorRole === "string" && spec.extractorRole.trim() !== ""
        ? spec.extractorRole
        : defaults.extractorRole,
      timeoutMs: typeof spec.timeoutMs === "number" && spec.timeoutMs > 0 ? spec.timeoutMs : defaults.timeoutMs,
    };
  } catch {
    return defaults;
  }
}

/** The slice of ExtensionContext an extraction needs. */
export type ExtractorContext = Pick<ExtensionContext, "model" | "modelRegistry">;

/**
 * Turns a request into a TaskContract candidate with one cheap model call.
 *
 * SpecEngine is constructed before any ExtensionContext exists, so the live
 * context is handed in each turn by before_agent_start rather than captured at
 * construction. Every failure path — extraction disabled, no model, no auth,
 * timeout, unparseable output — returns undefined, which leaves the engine's
 * deterministic contract standing. This never throws.
 */
export class ContractExtractor {
  private context: ExtractorContext | undefined;

  constructor(private readonly settings: SpecExtractionSettings = loadSpecSettings()) {}

  setContext(context: ExtractorContext): void {
    this.context = context;
  }

  get enabled(): boolean {
    return this.settings.extraction;
  }

  async extract(prompt: string, tier: SpecTier): Promise<unknown> {
    if (!this.settings.extraction || tier === "instant") return undefined;
    const context = this.context;
    if (!context) return undefined;

    try {
      const model = this.resolveModel(context);
      if (!model) return undefined;

      const auth = await resolveEvaluatorAuth(context.modelRegistry, model);
      const completion = completeSimple(
        model,
        {
          messages: [{
            role: "user",
            content: [{ type: "text", text: buildContractExtractionPrompt(prompt) }],
            timestamp: Date.now(),
          }],
        },
        { reasoning: "low", ...auth },
      );

      // Hard bound: the contract is only read at agent_end, but a hung provider
      // must never be what decides when a turn can finish. The loser's timer is
      // cleared — otherwise a completion that wins the race leaves it live for the
      // full timeout, once per turn, for the life of the session.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let message: Awaited<typeof completion> | undefined;
      try {
        message = await Promise.race([
          completion,
          new Promise<undefined>((resolve) => {
            timer = setTimeout(() => resolve(undefined), this.settings.timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (!message) return undefined;

      // completeSimple resolves rather than rejects on API failure, carrying
      // stopReason "error"/"aborted" with empty content.
      const result = message as { stopReason?: string; content?: Array<{ type?: string; text?: string }> };
      if (result.stopReason === "error" || result.stopReason === "aborted") return undefined;

      const text = (result.content ?? [])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text)
        .join("\n");

      return parseContractResponse(text);
    } catch {
      return undefined;
    }
  }

  /** Routed override when routing is on, else the session model — same as /goal. */
  private resolveModel(context: ExtractorContext): ExtractorContext["model"] {
    const override = loadEvaluatorOverride(this.settings.extractorRole);
    if (!override) return context.model;
    const routed = pickEvaluatorModel(
      override,
      context.modelRegistry.getAll(),
      (model) => context.modelRegistry.hasConfiguredAuth(model),
    );
    return routed?.model ?? context.model;
  }
}
