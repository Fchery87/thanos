#!/usr/bin/env node
// Thanos patches for pi-subagents. Idempotent; safe to run repeatedly.
//
// (Retired) Patch 1 (agents.ts): formerly stopped agent discovery from scanning
//   any directory named `skills`, because pi-subagents walked its agent roots
//   recursively with no exclusions and mis-registered skill managers'
//   <root>/skills/<name>/SKILL.md files (which carry name+description
//   frontmatter) as agents, flooding discovery.
//
//   Upstream took this over in 0.30.0 (2026-06-20, "Ignore legacy `.agents/skills`
//   files during agent discovery"): loadAgentsFromDir now drops paths matching
//   `.agents/skills/**` via isLegacyAgentSkillPath (agents.ts ~L1284-1312). The
//   patch kept applying anyway until 0.36.0 (2026-07-24) replaced the
//   `if (entry.isDirectory())` shape it anchored to with shouldPruneDiscoveryDir
//   (.git / node_modules / nested project roots), at which point it started
//   failing loudly on every `pi update`.
//
//   Retired rather than re-derived because upstream's coverage, while narrower,
//   covers every root that actually holds skills. Probed with synthetic SKILL.md
//   files under a fake HOME + PI_CODING_AGENT_DIR (2026-07-27, 0.37.1):
//     ~/.agents/skills/**          -> excluded
//     <proj>/.agents/skills/**     -> excluded
//     ~/.agents/notskills/**       -> REGISTERS (control: the exclusion, not some
//                                     unrelated filter, is what holds the line)
//     <agentDir>/agents/skills/**  -> leaks
//     <proj>/.pi/agents/skills/**  -> leaks
//   The two leaking paths are unreachable in practice: pi keeps user skills in
//   <agentDir>/skills and project skills in <proj>/.pi/skills — siblings of the
//   agent roots, never scanned — and nothing writes a `skills` dir *inside* an
//   agents dir. If that ever changes the symptom is loud (skill names appearing
//   in `subagent list`); the fix is a one-line patch adding "skills" to
//   DISCOVERY_PRUNED_DIR_NAMES, a far stabler anchor than the old code shape.
//
// Patch 2 (extension/fanout-child.ts): process-global guard against double
//   registration of the "subagent" tool. pi loads fanout-child.ts twice in fanout
//   children (explicit --extension AND the settings package's index.ts dispatch);
//   upstream's WeakSet only dedupes per ExtensionAPI instance, so the second load
//   crashed the child with a tool-name conflict (exit 1 on every reviewer run).
//
// (Retired) Patch 3 (tui/render.ts): formerly rendered multi-line "management"
//   tool output (doctor / list / get / status) line-by-line because upstream
//   truncated the whole blob to one line's width. Obsolete as of pi-subagents
//   0.31.0 (2026-06-26): renderToolResult now splits on "\n" and wrapPlainText's
//   each line natively (src/tui/render.ts ~L1401-1405) — strictly better than the
//   old truncate-per-line patch, so it has been removed rather than re-derived.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents", "src");

const patches = [
  {
    file: join(ROOT, "extension", "fanout-child.ts"),
    marker: "thanos-patch: process-global fanout tool guard",
    needle:
      "\tif (registeredApis.has(pi)) return;\n" +
      "\tregisteredApis.add(pi);",
    replacement:
      "\tif (registeredApis.has(pi)) return;\n" +
      "\tregisteredApis.add(pi);\n" +
      "\t// thanos-patch: process-global fanout tool guard — the upstream WeakSet only\n" +
      "\t// dedupes per ExtensionAPI instance, but pi loads this file twice in fanout\n" +
      "\t// children (explicit --extension fanout-child.ts AND the settings package's\n" +
      "\t// index.ts dispatch), each with its own API object. Both then register the\n" +
      '\t// "subagent" tool and the second load crashes with a tool-name conflict,\n' +
      "\t// killing every reviewer→explore nested run with exit 1.\n" +
      '\tconst __thanosToolKey = "__piSubagentFanoutChildToolRegistered";\n' +
      "\tif (globalStore[__thanosToolKey] === true) return;\n" +
      "\tglobalStore[__thanosToolKey] = true;",
  },
];

let applied = 0, already = 0, failed = 0;
for (const p of patches) {
  if (!existsSync(p.file)) {
    console.log(`[thanos-patch] target missing (skipped): ${p.file}`);
    continue;
  }
  let src = readFileSync(p.file, "utf-8");
  if (src.includes(p.marker)) {
    console.log(`[thanos-patch] already applied: ${p.marker}`);
    already++;
    continue;
  }
  if (!src.includes(p.needle)) {
    console.error(`[thanos-patch] FAILED — code shape not found for "${p.marker}" in ${p.file}`);
    console.error(`[thanos-patch] pi-subagents may have changed; review manually.`);
    failed++;
    continue;
  }
  writeFileSync(p.file, src.replace(p.needle, p.replacement), "utf-8");
  console.log(`[thanos-patch] applied: ${p.marker}`);
  applied++;
}

console.log(`[thanos-patch] done — ${applied} applied, ${already} already present, ${failed} failed.`);
process.exit(failed > 0 ? 1 : 0);
