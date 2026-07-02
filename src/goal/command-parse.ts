export type GoalCommand =
  | { type: "status" }
  | { type: "clear" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "set"; condition: string };

const CLEAR_ALIASES = new Set(["clear", "stop", "off", "reset", "none", "cancel"]);

export function parseGoalCommand(args: string): GoalCommand {
  const trimmed = args.trim();
  if (trimmed === "") return { type: "status" };
  const lower = trimmed.toLowerCase();
  if (CLEAR_ALIASES.has(lower)) return { type: "clear" };
  if (lower === "pause") return { type: "pause" };
  if (lower === "resume") return { type: "resume" };
  return { type: "set", condition: trimmed };
}
