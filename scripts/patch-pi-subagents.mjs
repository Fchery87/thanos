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

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents", "src");
const THANOS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGE_RELATIVE = join("agent", "npm", "node_modules", "pi-subagents");
const V2_PATCH = join(THANOS_ROOT, "scripts", "patches", "pi-subagents-0.37.2-v2-evidence.patch");
const V2_MARKERS = [
  ["api", "delegation.ts", "thanos-patch: V2 evidence envelope types"],
  ["slash", "delegation-request.ts", "thanos-patch: V2 acceptance request validation"],
  ["slash", "delegation-adapters.ts", "thanos-patch: V2 evidence envelope projection"],
];

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

function applyV2EvidencePatch() {
  const targets = V2_MARKERS.map(([dir, file, marker]) => ({
    file: join(ROOT, dir, file),
    marker,
  }));
  if (targets.some((target) => !existsSync(target.file))) {
    console.log("[thanos-patch] V2 evidence targets missing (skipped)");
    return;
  }
  if (targets.every((target) => readFileSync(target.file, "utf-8").includes(target.marker))) {
    console.log("[thanos-patch] already applied: V2 delegation evidence envelope");
    already++;
    return;
  }
  if (!existsSync(V2_PATCH)) {
    console.error(`[thanos-patch] V2 patch artifact missing: ${V2_PATCH}`);
    failed++;
    return;
  }
  const applyArgs = [`--directory=${PACKAGE_RELATIVE}`, "--whitespace=nowarn", V2_PATCH];
  const check = spawnSync("git", ["apply", "--check", ...applyArgs], {
    cwd: THANOS_ROOT,
    encoding: "utf-8",
  });
  if (check.status !== 0) {
    const reverse = spawnSync("git", ["apply", "--reverse", "--check", ...applyArgs], {
      cwd: THANOS_ROOT,
      encoding: "utf-8",
    });
    if (reverse.status === 0) {
      console.log("[thanos-patch] V2 evidence patch is already present");
      already++;
      return;
    }
    console.error(`[thanos-patch] V2 evidence patch does not match pinned pi-subagents 0.37.2: ${(check.stderr ?? "").trim()}`);
    failed++;
    return;
  }
  const apply = spawnSync("git", ["apply", ...applyArgs], {
    cwd: THANOS_ROOT,
    encoding: "utf-8",
  });
  if (apply.status !== 0) {
    console.error(`[thanos-patch] V2 evidence patch failed: ${(apply.stderr ?? "").trim()}`);
    failed++;
    return;
  }
  console.log("[thanos-patch] applied: V2 delegation evidence envelope");
  applied++;
}

applyV2EvidencePatch();

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
    // Neutral wording on purpose: a vanished anchor is not yet a verdict. The
    // behavioural probe below decides whether this is a regression or a patch
    // upstream has made redundant, and announcing "FAILED" here would contradict
    // the good-news case.
    console.log(`[thanos-patch] anchor not found for "${p.marker}" in ${p.file}`);
    console.log(`[thanos-patch] pi-subagents changed shape — verifying whether the patch is still needed...`);
    failed++;
    continue;
  }
  writeFileSync(p.file, src.replace(p.needle, p.replacement), "utf-8");
  console.log(`[thanos-patch] applied: ${p.marker}`);
  applied++;
}

// --- Behavioural verification -------------------------------------------
//
// The exit code reports whether pi-subagents *behaves* correctly, not whether
// our patch text is present. Those are different questions, and conflating them
// is what made this script cry wolf: when 0.36.0 refactored the code shape the
// retired skills patch anchored to, it reported FAILED even though discovery was
// fine because upstream had absorbed the fix in 0.30.0. A vanished anchor whose
// behaviour is still correct is good news — it means a patch can be retired.
//
// The probe double-loads the extension with two distinct ExtensionAPI objects,
// exactly as pi does in a fanout child (explicit --extension plus the settings
// package's index.ts dispatch), and asserts the "subagent" tool registers once.
// Unpatched, both loads register and the child dies with a tool-name conflict.
//
// Runs under bun, not node: node refuses to strip types under node_modules
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING), and the target is TypeScript
// source inside node_modules. install.sh already requires bun. A temp HOME keeps
// the probe from touching real config or artifact state.
function verifyFanoutGuard() {
  const target = join(ROOT, "extension", "fanout-child.ts");
  if (!existsSync(target)) return { status: "skipped", reason: "fanout-child.ts not installed" };
  if (spawnSync("bun", ["--version"], { stdio: "ignore" }).status !== 0) {
    return { status: "skipped", reason: "bun not on PATH" };
  }

  const dir = mkdtempSync(join(tmpdir(), "thanos-patch-verify-"));
  try {
    const probe = join(dir, "probe.mjs");
    writeFileSync(
      probe,
      `process.env.PI_SUBAGENT_CHILD = "1";\n` +
        `process.env.PI_SUBAGENT_FANOUT_CHILD = "1";\n` +
        `const mod = await import(${JSON.stringify(target)});\n` +
        `const calls = [];\n` +
        `const api = (tag) => ({ registerTool: (t) => calls.push(tag + ":" + t.name), on: () => {}, addEventListener: () => {}, registerCommand: () => {} });\n` +
        `mod.default(api("a"));\n` +
        `mod.default(api("b"));\n` +
        `console.log("THANOS_PROBE:" + calls.length);\n`,
      "utf-8",
    );
    const run = spawnSync("bun", ["run", probe], {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, HOME: dir },
    });
    const match = /THANOS_PROBE:(\d+)/.exec(run.stdout ?? "");
    if (!match) {
      const detail = (run.stderr ?? "").trim().split("\n").slice(-1)[0] || `exit ${run.status}`;
      return { status: "skipped", reason: `probe did not run (${detail})` };
    }
    const count = Number(match[1]);
    return count === 1
      ? { status: "ok", reason: "subagent tool registers exactly once across a double load" }
      : { status: "broken", reason: `subagent tool registered ${count}x across a double load (expected 1)` };
  } catch (error) {
    return { status: "skipped", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function verifyV2EvidenceEnvelope() {
  const target = join(ROOT, "slash", "delegation-adapters.ts");
  if (!existsSync(target)) return { status: "skipped", reason: "delegation adapter not installed" };
  if (spawnSync("bun", ["--version"], { stdio: "ignore" }).status !== 0) {
    return { status: "skipped", reason: "bun not on PATH" };
  }
  const dir = mkdtempSync(join(tmpdir(), "thanos-v2-verify-"));
  try {
    const probe = join(dir, "probe.mjs");
    writeFileSync(
      probe,
      `const mod = await import(${JSON.stringify(target)});\n` +
        `const request = { version: 2, requestId: "request-1", ownerRunId: "owner-1", nodeId: "node-1", agent: "reviewer", task: "review", context: "fresh", cwd: ".", acceptance: "verified", artifacts: true, result: { kind: "text" } };\n` +
        `const acceptance = { status: "accepted", evidenceStatus: "verified", explicit: true, childReport: { residualRisks: ["risk"] } };\n` +
        `const result = { content: [{ type: "text", text: "ok" }], isError: false, details: { runId: "run-1", results: [{ status: "completed", finalOutput: "ok", launchContractDigest: "${"a".repeat(64)}", execution: { status: "completed", success: true, exitCode: 0 }, acceptance, review: { status: "reviewed", findings: [] }, effects: { fileMutation: { status: "not-applicable", expected: false, attempted: false } } }] } };\n` +
        `const response = mod.toSubagentDelegationV2Response(request, result, false);\n` +
        `const ok = response.execution?.success === true && response.acceptance?.status === "accepted" && response.review?.status === "reviewed" && response.effects?.fileMutation?.status === "not-applicable" && Array.isArray(response.artifacts) && Array.isArray(response.warnings) && response.residualRisks?.[0] === "risk";\n` +
        `console.log("THANOS_V2_PROBE:" + (ok ? "ok" : JSON.stringify(response)));\n`,
      "utf-8",
    );
    const run = spawnSync("bun", ["run", probe], {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, HOME: dir },
    });
    const match = /THANOS_V2_PROBE:([^\n]+)/.exec(run.stdout ?? "");
    if (!match) {
      const detail = (run.stderr ?? "").trim().split("\n").slice(-1)[0] || `exit ${run.status}`;
      return { status: "skipped", reason: `V2 probe did not run (${detail})` };
    }
    return match[1] === "ok"
      ? { status: "ok", reason: "V2 response carries execution, acceptance, review, effects, artifacts, warnings, and residual risks" }
      : { status: "broken", reason: `V2 evidence envelope is incomplete (${match[1]})` };
  } catch (error) {
    return { status: "skipped", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const verdicts = [verifyFanoutGuard(), verifyV2EvidenceEnvelope()];
for (const verdict of verdicts) {
  if (verdict.status === "ok") {
    console.log(`[thanos-patch] verified: ${verdict.reason}`);
  } else if (verdict.status === "skipped") {
    console.log(`[thanos-patch] verification skipped — ${verdict.reason}`);
  } else {
    console.error(`[thanos-patch] BROKEN — ${verdict.reason}`);
  }
}

console.log(`[thanos-patch] done — ${applied} applied, ${already} already present, ${failed} failed.`);

// Behaviour is the gate. A patch that no longer applies but whose protection is
// now provided upstream is reported for retirement, not treated as a failure.
if (verdicts.some((verdict) => verdict.status === "broken")) process.exit(1);
if (failed > 0 && verdicts.every((verdict) => verdict.status === "ok")) {
  console.log(
    `[thanos-patch] ${failed} patch(es) no longer apply, but behaviour is correct — ` +
      `upstream likely absorbed the fix. Candidates for retirement; no action needed.`,
  );
  process.exit(0);
}
if (failed > 0 && verdicts.some((verdict) => verdict.status === "skipped")) {
  // Same exit code the final line would give; spelled out because "couldn't
  // verify" and "verified broken" are different situations and the operator
  // should not have to infer which one produced the failure.
  console.error(
    `[thanos-patch] ${failed} patch(es) no longer apply and behaviour could not be verified ` +
      `(${verdicts.filter((verdict) => verdict.status === "skipped").map((verdict) => verdict.reason).join("; ")}) — ` +
      "treating as failure rather than assuming upstream absorbed it.",
  );
  process.exit(1);
}
process.exit(failed > 0 ? 1 : 0);
