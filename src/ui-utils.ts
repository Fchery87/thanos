import type { FormalSpec } from "./spec/types";
import { truncateToWidth } from "@earendil-works/pi-tui";

export interface TUITheme {
  fg(color: string, text: string): string;
  bg(color: string, text: string): string;
  bold(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  inverse(text: string): string;
  strikethrough(text: string): string;
}

export const noopTheme: TUITheme = {
  fg: (_color, text) => text,
  bg: (_color, text) => text,
  bold: (text) => text,
  italic: (text) => text,
  underline: (text) => text,
  inverse: (text) => text,
  strikethrough: (text) => text,
};

export const DEFAULT_PICKER_LABEL_WIDTH = 72;
const MAX_PANEL_VISUAL_WIDTH = 80;
const MAX_PANEL_WIDTH = MAX_PANEL_VISUAL_WIDTH - 2;

export function fitTerminalText(text: string, width: number): string {
  return truncateToWidth(text, width);
}

export function fixedWidthTerminalText(text: string, width: number): string {
  return fitTerminalText(text, width).padEnd(width, " ");
}

export function makeTerminalSafeOptions(options: string[], width = DEFAULT_PICKER_LABEL_WIDTH): string[] {
  const used = new Set<string>();
  return options.map((option) => {
    let label = fitTerminalText(option, width);
    let suffixIndex = 2;
    while (used.has(label)) {
      const suffix = ` #${suffixIndex}`;
      const suffixWidth = stripAnsi(suffix).length;
      label = `${fitTerminalText(option, Math.max(0, width - suffixWidth))}${suffix}`;
      suffixIndex += 1;
    }
    used.add(label);
    return label;
  });
}

export function formatBadge(theme: TUITheme, decision: string): string {
  if (decision === "allow") {
    return theme.fg("success", "✓");
  } else if (decision === "deny") {
    return theme.fg("error", "✗");
  } else if (decision === "ask") {
    return theme.fg("warning", "?");
  } else {
    return theme.fg("dim", "·");
  }
}

export function formatLabel(theme: TUITheme, text: string, padTo = 0): string {
  const padded = text.padEnd(padTo, " ");
  return theme.bold(padded);
}

export function formatValue(theme: TUITheme, text: string, type: "normal" | "accent" | "dim" = "normal"): string {
  if (type === "accent") return theme.fg("accent", text);
  if (type === "dim") return theme.fg("dim", text);
  return text;
}

export function formatSpecForApproval(spec: FormalSpec, theme: TUITheme): string {
  const criteria = spec.acceptanceCriteria
    .map((c) => `  ${theme.fg("dim", "-")} ${theme.fg("muted", `[${c.id}]`)} ${c.evidenceRequired.join(", ")}`)
    .join("\n");
    
  const targetFiles = spec.targetFiles.length > 0 
    ? spec.targetFiles.map(f => theme.fg("accent", f)).join(", ") 
    : theme.fg("dim", "(not specified)");
    
  const allowedCaps = spec.allowedCapabilities.length > 0
    ? spec.allowedCapabilities.map(c => theme.fg("success", c)).join(", ")
    : theme.fg("dim", "none");
  const workflow = spec.workflowPlan
    ? [
        "",
        `${theme.bold("Workflow:")} ${spec.workflowPlan.id} (${spec.workflowPlan.nodes.length} bounded nodes)`,
        ...spec.workflowPlan.nodes.map((node) =>
          `  ${theme.fg("dim", "-")} ${node.id} → ${node.agent} [read-only]`),
        `  ${theme.fg("dim", "-")} integration → parent [write: ${spec.workflowPlan.integration.targetRoots.join(", ")}]`,
      ]
    : [];

  return [
    `${theme.bold("Goal:")} ${spec.goal}`,
    "",
    `${theme.bold("Allowed capabilities:")} ${allowedCaps}`,
    `${theme.bold("Target files:")}         ${targetFiles}`,
    ...workflow,
    "",
    `${theme.bold("Evidence required:")}`,
    criteria,
    "",
    theme.bold(theme.fg("accent", "Approve?")),
  ].join("\n");
}

/**
 * One spelling of "how a criterion reads", shared by the turn summary and the
 * /spec panel.
 *
 * The two used to render this independently and had drifted: agent_end showed a
 * red ✗ for every unmet criterion including advisory ones and titled the panel
 * "Spec Verification Failed", while the gate had already decided advisory
 * criteria are not actionable — so every audit or investigation prompt showed a
 * failure that nothing would ever act on.
 *
 * Advisory criteria get a dim marker and an explicit tag: reported, not blocking.
 */
export function renderCriteriaLines(
  theme: TUITheme,
  results: Array<{ criterion: { id: string; statement: string }; passed: boolean; advisory?: boolean }>,
  opts: { showIds?: boolean } = {},
): string[] {
  return results.map((result) => {
    const marker = result.passed
      ? theme.fg("success", "✓")
      : result.advisory
        ? theme.fg("dim", "·")
        : theme.fg("error", "✗");
    const id = opts.showIds ? `${theme.fg("muted", `[${result.criterion.id}]`)}  ` : "";
    const tag = !result.passed && result.advisory ? ` ${theme.fg("dim", "(advisory)")}` : "";
    return `  ${marker}  ${id}${result.criterion.statement}${tag}`;
  });
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

export function formatPanel(theme: TUITheme, title: string, content: string | string[], borderColor: "dim" | "accent" | "success" | "warning" | "error" = "dim"): string {
  const rawLines = Array.isArray(content) ? content : content.split("\n");
  
  const topL = "╭";
  const topR = "╮";
  const botL = "╰";
  const botR = "╯";
  const hz = "─";
  const vt = "│";

  let maxLineWidth = stripAnsi(title).length + 4;
  for (const line of rawLines) {
    const len = stripAnsi(line).length;
    if (len > maxLineWidth) maxLineWidth = len;
  }
  
  const panelWidth = Math.min(MAX_PANEL_WIDTH, Math.max(60, maxLineWidth + 2));
  const contentWidth = Math.max(1, panelWidth - 2);
  const lines = rawLines.map((line) => fitTerminalText(line, contentWidth));

  const border = (char: string) => theme.fg(borderColor, char);

  const titleText = fitTerminalText(title, Math.max(1, panelWidth - 4));
  const titleStrip = stripAnsi(titleText);
  const leftHzCount = 1;
  const rightHzCount = Math.max(0, panelWidth - titleStrip.length - leftHzCount - 2);
  
  const topBorder = `${border(topL)}${border(hz)} ${theme.bold(titleText)} ${border(hz.repeat(rightHzCount))}${border(topR)}`;
  
  const paddedLines = lines.map(line => {
    const visualLen = stripAnsi(line).length;
    const paddingRight = " ".repeat(Math.max(0, panelWidth - visualLen - 2));
    return `${border(vt)} ${line}${paddingRight} ${border(vt)}`;
  });

  const botBorder = `${border(botL)}${border(hz.repeat(panelWidth))}${border(botR)}`;

  return [topBorder, ...paddedLines, botBorder].join("\n");
}
