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
  const commands = renderBox(theme, "Start here", renderCommandRows(theme, Math.min(w, 54) - 2), Math.min(w, 54), "accent");
  const hotkeys = renderBox(theme, "Hotkeys", renderHotkeyRows(theme, Math.min(w, 54) - 2), Math.min(w, 54));
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
    ...renderBox(theme, "Start here", renderCommandRows(theme, rightWidth - 2), rightWidth, "accent"),
    "",
    ...renderBox(theme, "Hotkeys", renderHotkeyRows(theme, rightWidth - 2), rightWidth),
  ];

  const rows = Math.max(left.length, right.length);
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const l = left[i] ?? "";
    const r = right[i] ?? "";
    lines.push(`${l}${" ".repeat(Math.max(0, leftWidth - stripAnsi(l).length + gap))}${r}`);
  }
  return lines;
}

const THANOS_LOGO = [
  "████████╗██╗  ██╗ █████╗ ███╗   ██╗ ██████╗ ███████╗",
  "╚══██╔══╝██║  ██║██╔══██╗████╗  ██║██╔═══██╗██╔════╝",
  "   ██║   ███████║███████║██╔██╗ ██║██║   ██║███████╗",
  "   ██║   ██╔══██║██╔══██║██║╚██╗██║██║   ██║╚════██║",
  "   ██║   ██║  ██║██║  ██║██║ ╚████║╚██████╔╝███████║",
  "   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝",
] as const;

function renderBrand(theme: TUITheme, width: number): string[] {
  const subtitle = theme.fg("dim", truncate("team-grade governance · policy-aware tools · evidence-first work", width));
  if (width < 56) {
    const title = `${theme.bold(theme.fg("accent", "THANOS"))} ${theme.fg("dim", "Agent Distribution for Pi")}`;
    return [fitAnsi(title, width), subtitle];
  }
  return [
    ...THANOS_LOGO.map((line) => theme.fg("accent", truncate(line, width))),
    theme.fg("dim", truncate("Agent Distribution for Pi", width)),
    subtitle,
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
    command(theme, "/status", "full session snapshot", width),
    command(theme, "/policy", "preset, rules, audit", width),
    command(theme, "/tools", "tool policy disposition", width),
    command(theme, "/mcp", "servers, auth, lifecycle", width),
    command(theme, "/skills", "loaded capabilities", width),
    command(theme, "/modes", "default specialist", width),
  ];
}

function renderHotkeyRows(theme: TUITheme, width: number): string[] {
  return [
    truncateAnsi(`${theme.fg("dim", "Ctrl+Shift+T")} thinking`, width),
    truncateAnsi(`${theme.fg("dim", "Ctrl+Shift+S")} snapshot  ${theme.fg("dim", "Ctrl+Shift+E")} spec`, width),
    truncateAnsi(`${theme.fg("dim", "Ctrl+Shift+P")} policy    ${theme.fg("dim", "Ctrl+Shift+R")} review`, width),
    truncateAnsi(`${theme.fg("dim", "Ctrl+Shift+D")} designer  ${theme.fg("dim", "Ctrl+Shift+Y")} yolo`, width),
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
  return ` ${theme.fg("accent", name.padEnd(nameWidth, " "))}${theme.fg("dim", truncate(description, descriptionWidth))}`;
}

function renderBox(theme: TUITheme, title: string, lines: string[], width: number, borderColor: "dim" | "accent" = "dim"): string[] {
  const boxWidth = Math.max(12, width);
  const inner = boxWidth - 2;
  const safeTitle = truncate(title, Math.max(1, inner - 4));
  const border = (s: string) => theme.fg(borderColor, s);
  const topPrefix = `─ ${safeTitle} `;
  const top = `${border("╭")}${border(topPrefix)}${border("─".repeat(Math.max(0, inner - topPrefix.length)))}${border("╮")}`;
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
