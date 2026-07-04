import type { TUITheme } from "../ui-utils";
import { stripAnsi } from "../ui-utils";

export type WelcomeRecentRow = { label: string; age: string };
export type WelcomeMcpSummary = { configured: number; connected: number; failed: number; initFailed: boolean };


export type WelcomePolicySummary =
  | { kind: "loaded"; preset: string; rules: number; auditEnabled: boolean }
  | { kind: "error" };

export interface WelcomeHeaderArgs {
  modelStr: string;
  thinkingStr: string;
  modeStr: string;
  mcp: WelcomeMcpSummary;
  policy: WelcomePolicySummary;
  recentRows: WelcomeRecentRow[];
}

export function formatTimeAgo(date: Date, now = Date.now()): string {
  const diff = Math.max(0, now - date.getTime());
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  if (m > 0) return `${m}m ago`;
  return "just now";
}

export function renderWelcomeHeader(theme: TUITheme, args: WelcomeHeaderArgs): { invalidate: () => void; render: (width: number) => string[] } {
  return {
    invalidate: () => {},
    render: (width: number) => renderWelcomeLines(theme, args, width),
  };
}

function renderWelcomeLines(theme: TUITheme, args: WelcomeHeaderArgs, width: number): string[] {
  const w = Math.max(1, Math.floor(width || 100));
  if (w < 24) {
    return [
      truncate("THANOS", w),
      truncate("Use /status", w),
    ];
  }

  const brand = renderBrand(theme, w);
  const status = renderBox(theme, "Session", renderSessionRows(theme, args, Math.min(w, 64) - 2), Math.min(w, 64));
  const commands = renderBox(theme, "Commands", renderCommandRows(theme, Math.min(w, 54) - 2), Math.min(w, 54));
  const hotkeys = renderBox(theme, "Shortcuts", renderHotkeyRows(theme, Math.min(w, 54) - 2), Math.min(w, 54));
  const recent = renderBox(theme, "Recent work", renderRecentRows(theme, args.recentRows, Math.min(w, 64) - 2), Math.min(w, 64));
  if (w < 108) {
    return [...brand, "", ...status, "", ...commands, "", ...hotkeys, "", ...recent];
  }

  const gap = 3;
  const leftWidth = Math.min(68, Math.max(58, Math.floor((w - gap) * 0.56)));
  const rightWidth = w - gap - leftWidth;
  const left = [
    ...renderBrand(theme, leftWidth),
    "",
    ...renderBox(theme, "Session", renderSessionRows(theme, args, leftWidth - 2), leftWidth),
    "",
    ...renderBox(theme, "Recent work", renderRecentRows(theme, args.recentRows, leftWidth - 2), leftWidth),
  ];
  const right = [
    ...renderBox(theme, "Commands", renderCommandRows(theme, rightWidth - 2), rightWidth),
    "",
    ...renderBox(theme, "Shortcuts", renderHotkeyRows(theme, rightWidth - 2), rightWidth),
  ];

  const rows = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    const joined = `${l}${" ".repeat(Math.max(0, leftWidth - stripAnsi(l).length + gap))}${r}`;
    // Right column is ragged (shorter than the left stack), and blank spacer
    // rows pad out to full width — trim the trailing gutter so the screen
    // doesn't ship lines full of invisible whitespace.
    lines.push(trimTrailing(joined));
  }
  return lines;
}

function trimTrailing(line: string): string {
  return line.replace(/[ \t]+$/, "");
}

const THANOS_LOGO = [
  "████████╗██╗  ██╗ █████╗ ███╗   ██╗ ██████╗ ███████╗",
  "╚══██╔══╝██║  ██║██╔══██╗████╗  ██║██╔═══██╗██╔════╝",
  "   ██║   ███████║███████║██╔██╗ ██║██║   ██║███████╗",
  "   ██║   ██╔══██║██╔══██║██║╚██╗██║██║   ██║╚════██║",
  "   ██║   ██║  ██║██║  ██║██║ ╚████║╚██████╔╝███████║",
  "   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝",
] as const;

// Vertical gradient for the wordmark. The thinking-level tokens are the one
// guaranteed brightness ramp in every pi theme, so the fade tracks whatever
// theme is active (in the thanos theme: pale lavender → deep amethyst).
const LOGO_RAMP = [
  "thinkingXhigh",
  "thinkingHigh",
  "thinkingHigh",
  "thinkingMedium",
  "thinkingMedium",
  "thinkingLow",
] as const;

// The infinity stones: one gem per feature. The amethyst wordmark above is
// the power stone; these five complete the gauntlet.
const STONES = [
  { color: "error", label: "governance" }, // reality
  { color: "syntaxNumber", label: "subagents" }, // soul
  { color: "mdLink", label: "web" }, // space
  { color: "success", label: "quality" }, // time
  { color: "warning", label: "86+ skills" }, // mind
] as const;

function renderStoneStrip(theme: TUITheme, width: number): string {
  const parts: string[] = [];
  let used = 0;
  for (const stone of STONES) {
    const plainWidth = 2 + stone.label.length;
    const sep = parts.length > 0 ? 2 : 0;
    if (used + sep + plainWidth > width) break;
    parts.push(`${theme.fg(stone.color, "◆")} ${theme.fg("dim", stone.label)}`);
    used += sep + plainWidth;
  }
  if (parts.length === 0) {
    return theme.fg("dim", truncate("governance · subagents · web · quality · skills", width));
  }
  return parts.join("  ");
}

function renderBrand(theme: TUITheme, width: number): string[] {
  if (width < 56) {
    const title = `${theme.bold(theme.fg("accent", "THANOS"))} ${theme.fg("dim", "Agent Distribution for Pi")}`;
    return [fitAnsi(title, width), renderStoneStrip(theme, width)];
  }
  return [
    ...THANOS_LOGO.map((line, i) => theme.bold(theme.fg(LOGO_RAMP[i], truncate(line, width)))),
    theme.bold(truncate("Agent Distribution for Pi", width)),
    renderStoneStrip(theme, width),
  ];
}

function renderSessionRows(theme: TUITheme, args: WelcomeHeaderArgs, width: number): string[] {
  const mcp = formatMcpSummary(args.mcp);
  const policy = args.policy.kind === "loaded"
    ? `${args.policy.preset} · ${args.policy.rules} rules · audit ${args.policy.auditEnabled ? "on" : "off"}`
    : "policy error";
  return [
    keyValue(theme, "model", args.modelStr, width, "accent"),
    keyValue(theme, "thinking", args.thinkingStr, width, args.thinkingStr === "off" ? "dim" : "accent"),
    keyValue(theme, "mode", args.modeStr, width, "accent"),
    keyValue(theme, "mcp", mcp, width, args.mcp.connected > 0 ? "success" : args.mcp.failed > 0 || args.mcp.initFailed ? "warning" : "dim"),
    keyValue(theme, "policy", policy, width, args.policy.kind === "loaded" ? "success" : "warning"),
  ];
}

function renderCommandRows(theme: TUITheme, width: number): string[] {
  return [
    command(theme, "/models", "provider → model selector", width),
    command(theme, "/status", "session snapshot", width),
    command(theme, "/policy", "policy and audit posture", width),
    command(theme, "/tools", "available tool surface", width),
    command(theme, "/skills", "installed agent skills", width),
    command(theme, "/designer", "spawn Designer subagent", width),
    command(theme, "/run", "pi-subagents runner", width),
    command(theme, "/lens", "lite code safety + diagnostics", width),
    command(theme, "/thinking", "select thinking level", width),
    command(theme, "/mcp", "servers, auth, lifecycle", width),
  ];
}

function renderHotkeyRows(theme: TUITheme, width: number): string[] {
  // Leading space matches the inner padding of the Session/Commands rows so
  // every box lines its content up against the same left edge. Chords carry
  // the gauntlet gold (mdCode) so the actionable part is what pops.
  const inner = Math.max(0, width - 1);
  const chord = (keys: string) => theme.fg("mdCode", keys);
  const label = (text: string) => theme.fg("dim", text);
  return [
    ` ${truncateAnsi(`${chord("Ctrl+Shift+T")} ${label("thinking")}  ${chord("Ctrl+Shift+Y")} ${label("yolo")}`, inner)}`,
    ` ${truncateAnsi(`${chord("Ctrl+Shift+F")} ${label("snapshot")}   ${chord("Ctrl+Shift+G")} ${label("policy")}`, inner)}`,
    ` ${truncateAnsi(`${chord("Ctrl+Shift+R")} ${label("review")}     ${chord("Ctrl+Shift+D")} ${label("designer")}`, inner)}`,
    ` ${truncateAnsi(`${chord("Ctrl+Shift+E")} ${label("spec")}       ${chord("Ctrl+Shift+A")} ${label("audit")}`, inner)}`,
  ];
}

function renderRecentRows(theme: TUITheme, rows: WelcomeRecentRow[], width: number): string[] {
  if (rows.length === 0) return [theme.fg("dim", "No recent sessions")];
  return rows.slice(0, 4).map(({ label, age }) => {
    const suffix = ` (${age})`;
    const labelWidth = Math.max(8, width - stripAnsi(suffix).length - 3);
    return ` ${theme.fg("accent", "•")} ${truncate(label, labelWidth)}${theme.fg("dim", suffix)}`;
  });
}

function formatMcpSummary(mcp: WelcomeMcpSummary): string {
  if (mcp.initFailed) {
    const base = `MCP init error · ${mcp.connected}/${mcp.configured} connected`;
    return mcp.failed > 0 ? `${base} · ${mcp.failed} failed` : base;
  }
  if (mcp.configured === 0) return "No MCP servers";
  const base = mcp.configured === mcp.connected
    ? `${mcp.connected} connected`
    : `${mcp.connected}/${mcp.configured} connected`;
  return mcp.failed > 0 ? `${base} · ${mcp.failed} failed` : base;
}

function keyValue(theme: TUITheme, key: string, value: string, width: number, color: "accent" | "success" | "warning" | "dim"): string {
  const keyWidth = 9;
  const valueWidth = Math.max(0, width - keyWidth - 2);
  return ` ${theme.fg("dim", key.padEnd(keyWidth, " "))}${theme.fg(color, truncate(value, valueWidth))}`;
}

function command(theme: TUITheme, name: string, description: string, width: number): string {
  const nameWidth = 10;
  const descriptionWidth = Math.max(0, width - nameWidth - 2);
  return ` ${theme.fg("mdCode", name.padEnd(nameWidth, " "))}${theme.fg("dim", truncate(description, descriptionWidth))}`;
}

function renderBox(theme: TUITheme, title: string, lines: string[], width: number): string[] {
  const boxWidth = Math.max(12, width);
  const inner = boxWidth - 2;
  const safeTitle = truncate(title, Math.max(1, inner - 4));
  // Frames use `dim` (not borderMuted): brogrammer's borderMuted is #222222,
  // which disappears against its #131313 background.
  const border = (s: string) => theme.fg("dim", s);
  const topPrefix = `─ ${safeTitle} `;
  const titleCell = `${border("─ ")}${theme.bold(theme.fg("accent", safeTitle))}${border(" ")}`;
  const top = `${border("╭")}${titleCell}${border("─".repeat(Math.max(0, inner - topPrefix.length)))}${border("╮")}`;
  const body = lines.map((line) => {
    const safe = fitAnsi(line, inner);
    return `${border("│")}${safe}${" ".repeat(Math.max(0, inner - stripAnsi(safe).length))}${border("│")}`;
  });
  const bottom = `${border("╰")}${border("─".repeat(inner))}${border("╯")}`;
  return [top, ...body, bottom];
}

function fitAnsi(text: string, width: number): string {
  return stripAnsi(text).length <= width ? text : truncateAnsi(text, width);
}

function truncateAnsi(text: string, width: number): string {
  if (stripAnsi(text).length <= width) return text;
  return truncate(stripAnsi(text), width);
}

function truncate(text: string, width: number): string {
  if (width <= 0) return "";
  if (text.length <= width) return text;
  if (width === 1) return "…";
  return `${text.slice(0, width - 1)}…`;
}
