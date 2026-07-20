// Builds the compact subagent roster injected into the parent system prompt.
//
// Rationale: the delegation directive used to tell the model to call
// `subagent {action:"list"}` before any non-trivial work. Models obeyed it on
// every prompt, dumping the full roster (~700 tokens) into the transcript each
// turn. The roster is static within a session, so the harness reads the same
// agent definitions the pi-subagents engine dispatches (agent/agents/*.md, plus
// the project scope) and injects a one-line-per-agent summary into the system
// prompt instead — zero tool round-trips, and it lives in the cached prefix.
//
// This is a routing HINT, not the execution authority: the `subagent` tool
// still validates agent names and disabled state at execution time, so a
// slightly stale roster degrades to a tool error, never a wrong dispatch.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface RosterEntry {
  name: string;
  description: string;
  scope: "user" | "project";
  defaultContext?: string;
}

const MAX_NAME_LENGTH = 48;
const MAX_DESCRIPTION_LENGTH = 240;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** User-scope agents dispatched by the pi-subagents engine (same dir as loader.ts). */
export function userAgentsDir(): string {
  return join(process.env.HOME ?? "~", ".pi", "agent", "agents");
}

/** Project-scope agents; pi-subagents resolves these under <projectRoot>/.pi/agents. */
export function projectAgentsDir(projectRoot: string): string {
  return join(projectRoot, ".pi", "agents");
}

interface ParsedAgentFrontmatter {
  name?: string;
  description?: string;
  disabled?: boolean;
  defaultContext?: string;
}

/**
 * Minimal frontmatter reader for the roster's routing fields. Every live agent
 * .md uses single-line `key: value` fields for these (see
 * tests/agents/roster-contract.test.ts, which enforces the same shape).
 */
function parseRosterFrontmatter(raw: string): ParsedAgentFrontmatter | null {
  const lines = raw.split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const closingIndex = lines.slice(1).findIndex((l) => l === "---") + 1;
  if (closingIndex <= 0) return null;

  const fields: Record<string, string> = {};
  for (const line of lines.slice(1, closingIndex)) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (match) fields[match[1]!] = match[2]!.trim();
  }

  return {
    name: fields.name || undefined,
    description: fields.description || undefined,
    disabled: fields.disabled === "true",
    defaultContext: fields.defaultContext || undefined,
  };
}

function normalizeField(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (value.trim() === "") return undefined;
  if (CONTROL_CHARS.test(value)) return undefined;
  if (value.length > maxLength) return undefined;
  return value;
}

async function loadScope(dir: string, scope: "user" | "project"): Promise<RosterEntry[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return []; // scope dir absent (e.g. no project agents) — not an error
  }

  const entries: RosterEntry[] = [];
  for (const file of files.sort()) {
    try {
      const parsed = parseRosterFrontmatter(await readFile(join(dir, file), "utf-8"));
      if (!parsed || parsed.disabled) continue;
      const name = normalizeField(parsed.name ?? file.replace(/\.md$/, ""), MAX_NAME_LENGTH);
      const description = normalizeField(parsed.description, MAX_DESCRIPTION_LENGTH);
      if (!name || !description) continue;
      entries.push({
        name,
        description,
        scope,
        defaultContext: parsed.defaultContext,
      });
    } catch {
      // Unreadable definition: skip it rather than fail the whole roster —
      // the subagent tool remains the execution-time authority.
    }
  }
  return entries;
}

/**
 * Loads the deduplicated live roster. Project scope wins on name collisions,
 * mirroring pi-subagents discovery ("project wins on name collisions").
 * Never throws — a missing or unreadable scope contributes no entries.
 */
export async function loadRoster(
  dirs: { userDir?: string; projectDir?: string } = {},
): Promise<RosterEntry[]> {
  const [user, project] = await Promise.all([
    loadScope(dirs.userDir ?? userAgentsDir(), "user"),
    loadScope(dirs.projectDir ?? projectAgentsDir(process.cwd()), "project"),
  ]);
  const byName = new Map<string, RosterEntry>();
  for (const entry of [...user, ...project]) byName.set(entry.name, entry);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One line per agent, mirroring what `subagent {action:"list"}` would return:
 * the description IS the routing signal, so it is kept verbatim.
 */
export function formatRoster(entries: RosterEntry[]): string {
  return entries
    .map((e) => {
      const tags: string[] = [];
      if (e.scope === "project") tags.push("project");
      if (e.defaultContext === "fork") tags.push("context: fork");
      const tag = tags.length ? ` (${tags.join(", ")})` : "";
      return `- ${e.name}${tag}: ${e.description}`.trimEnd();
    })
    .join("\n");
}
