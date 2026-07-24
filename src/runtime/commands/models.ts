import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_PICKER_LABEL_WIDTH,
  fitTerminalText,
  fixedWidthTerminalText,
  stripAnsi,
} from "../../ui-utils";

/** /models — two-step provider→model selector. */
export function registerModelsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("models", {
    description: "Select model by provider (two-step picker)",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("Model selector requires an interactive UI", "warning");
        return;
      }

      const theme = ctx.ui.theme;
      const models = ctx.modelRegistry.getAll();

      if (models.length === 0) {
        ctx.ui.notify("No models are registered. Add a provider catalog or update Pi.", "warning");
        return;
      }
      const configuredModels = models.filter((m) => ctx.modelRegistry.hasConfiguredAuth(m));
      if (configuredModels.length === 0) {
        ctx.ui.notify("No configured model providers found. Add an API key or OAuth credentials, then reopen /models.", "warning");
        return;
      }

      // Step 1: Group models by authenticated provider so /models only offers
      // providers that can actually switch successfully.
      const providerMap = new Map<string, typeof configuredModels>();
      for (const m of configuredModels) {
        const list = providerMap.get(m.provider) ?? [];
        list.push(m);
        providerMap.set(m.provider, list);
      }

      // Sort providers alphabetically, with current provider first
      const currentProvider = ctx.model?.provider;
      const providers = [...providerMap.entries()].sort(([a], [b]) => {
        if (a === currentProvider) return -1;
        if (b === currentProvider) return 1;
        return a.localeCompare(b);
      });

      // Format provider labels with model count
      const providerLabels = providers.map(([name, models]) => {
        const tag = name === currentProvider ? theme.fg("accent", "●") : theme.fg("dim", "○");
        const authed = models.some((m) => ctx.modelRegistry.hasConfiguredAuth(m));
        const authLabel = authed ? "configured" : "needs key";
        return fitTerminalText(`${tag} ${theme.bold(fixedWidthTerminalText(name, 24))} ${theme.fg("dim", `${models.length} model${models.length !== 1 ? "s" : ""} · ${authLabel}`)}`, DEFAULT_PICKER_LABEL_WIDTH);
      });

      const selectedProvider = await ctx.ui.select("Select provider", providerLabels);
      if (!selectedProvider) return; // cancelled

      const providerIndex = providerLabels.indexOf(selectedProvider);
      if (providerIndex < 0) return;
      const [providerName, providerModels] = providers[providerIndex]!;

      // Sort models: current model first, then by name/id
      const currentModelId = ctx.model?.id;
      const sortedModels = [...providerModels].sort((a, b) => {
        const aCurrent = a.provider === ctx.model?.provider && a.id === currentModelId;
        const bCurrent = b.provider === ctx.model?.provider && b.id === currentModelId;
        if (aCurrent && !bCurrent) return -1;
        if (!aCurrent && bCurrent) return 1;
        return (a.name || a.id).localeCompare(b.name || b.id);
      });

      // Step 2: Pick model within provider
      const modelLabels = sortedModels.map((m) => {
        const isCurrent = m.provider === ctx.model?.provider && m.id === currentModelId;
        const brain = m.reasoning ? "\u{1F9E0}" : "";
        const img = m.input?.includes("image") ? " \u{1F4F7}" : "";
        const tag = isCurrent ? theme.fg("success", " ✓") : "";
        const ctxK = m.contextWindow ? `${Math.round(m.contextWindow / 1000)}k` : "?";
        const outK = m.maxTokens ? `${Math.round(m.maxTokens / 1000)}k` : "?";
        const auth = ctx.modelRegistry.hasConfiguredAuth(m) ? "" : theme.fg("warning", " · needs key");
        const dims = theme.fg("dim", `${ctxK} ctx · ${outK} out`);
        const suffix = ` ${dims}${brain}${img}${auth}${tag}`;
        const nameWidth = Math.max(16, DEFAULT_PICKER_LABEL_WIDTH - stripAnsi(suffix).length);
        const id = theme.fg("accent", fixedWidthTerminalText(m.name || m.id, nameWidth));
        return fitTerminalText(`${id}${suffix}`, DEFAULT_PICKER_LABEL_WIDTH);
      });

      const selectedModel = await ctx.ui.select(
        `Models for ${providerName}`,
        modelLabels,
      );
      if (!selectedModel) return; // cancelled

      const modelIndex = modelLabels.indexOf(selectedModel);
      if (modelIndex < 0) return;
      const model = sortedModels[modelIndex]!;

      // Step 3: Switch model (triggers model_select → thinking level prompt)
      try {
        const switched = await pi.setModel(model);
        if (switched) {
          ctx.ui.notify(`Switched to ${model.provider}/${model.id}`, "info");
        } else {
          ctx.ui.notify(`No API key for ${model.provider}/${model.id}`, "warning");
        }
      } catch (err) {
        ctx.ui.notify(`Failed to switch: ${err instanceof Error ? err.message : String(err)}`, "warning");
      }
    },
  });
}
