#!/usr/bin/env node
// Thanos patches for pi-subagents. Idempotent; safe to run repeatedly.
//
// Patch 1 (agents.ts): stop scanning `skills/` directories as agents. pi-subagents
//   walks ~/.agents and ~/.pi/agent/agents recursively with no exclusions, so skill
//   managers' <root>/skills/<name>/SKILL.md files (which carry name+description
//   frontmatter) get mis-registered as agents — flooding discovery. Does NOT affect
//   how the pi skill system loads skills; only agent discovery.
//
// Patch 2 (tui/render.ts): render multi-line "management" tool output (doctor / list /
//   get / status) line-by-line. Upstream shoves the entire report into a single
//   `new Text(truncLine(text, width))`, truncating the whole blob to one line's width
//   — which is why `/subagents-doctor` cut off mid-line in the Runtime section.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const ROOT = join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents", "src");

const patches = [
  {
    file: join(ROOT, "agents", "agents.ts"),
    marker: "thanos-patch: skip skills dirs",
    needle:
      "\t\tif (entry.isDirectory()) {\n" +
      "\t\t\tfiles.push(...listFilesRecursive(filePath, predicate));",
    replacement:
      "\t\tif (entry.isDirectory()) {\n" +
      '\t\t\tif (entry.name === "skills") continue; // thanos-patch: skip skills dirs\n' +
      "\t\t\tfiles.push(...listFilesRecursive(filePath, predicate));",
  },
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
  {
    file: join(ROOT, "tui", "render.ts"),
    marker: "thanos-patch: multi-line management output",
    needle:
      "\t\treturn new Text(truncLine(`${contextPrefix}${text}`, getTermWidth() - 4), 0, 0);",
    replacement:
      "\t\t// thanos-patch: multi-line management output (doctor/list/get/status)\n" +
      "\t\tconst __thanosFull = `${contextPrefix}${text}`;\n" +
      "\t\tif (__thanosFull.includes(\"\\n\")) {\n" +
      "\t\t\tconst __thanosBox = new Container();\n" +
      "\t\t\tfor (const __thanosLine of __thanosFull.split(\"\\n\")) __thanosBox.addChild(new Text(truncLine(__thanosLine, getTermWidth() - 4), 0, 0));\n" +
      "\t\t\treturn __thanosBox;\n" +
      "\t\t}\n" +
      "\t\treturn new Text(truncLine(__thanosFull, getTermWidth() - 4), 0, 0);",
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
