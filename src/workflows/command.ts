export type WavesCommand =
  | { kind: "status" }
  | { kind: "start"; goal: string }
  | { kind: "attach_goal" }
  | { kind: "pause" }
  | { kind: "resume"; maxIntegrationTurns?: number; maxJuryRounds?: number }
  | { kind: "cancel" }
  | { kind: "handoff" }
  | { kind: "invalid"; reason: string };

const EXACT_COMMANDS = new Map<string, WavesCommand>([
  ["status", { kind: "status" }],
  ["goal", { kind: "attach_goal" }],
  ["pause", { kind: "pause" }],
  ["cancel", { kind: "cancel" }],
  ["handoff", { kind: "handoff" }],
]);

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function parseWavesCommand(args: string): WavesCommand {
  const trimmed = args.trim();
  if (trimmed === "") return { kind: "status" };

  const normalized = trimmed.toLowerCase();
  const exact = EXACT_COMMANDS.get(normalized);
  if (exact) return exact;
  if (normalized === "resume") return { kind: "resume" };
  if (!normalized.startsWith("resume ")) return { kind: "start", goal: trimmed };

  const tokens = trimmed.split(/\s+/);
  const limits: { maxIntegrationTurns?: number; maxJuryRounds?: number } = {};
  const seen = new Set<string>();
  for (let index = 1; index < tokens.length; index += 2) {
    const flag = tokens[index]?.toLowerCase();
    const field = flag === "--max-integration-turns"
      ? "maxIntegrationTurns"
      : flag === "--max-jury-rounds"
        ? "maxJuryRounds"
        : undefined;
    const value = positiveInteger(tokens[index + 1]);
    if (!flag || !field || value === undefined || seen.has(flag)) {
      return {
        kind: "invalid",
        reason:
          "Usage: /waves resume [--max-integration-turns <positive-total>] [--max-jury-rounds <positive-total>]",
      };
    }
    seen.add(flag);
    limits[field] = value;
  }
  return { kind: "resume", ...limits };
}
