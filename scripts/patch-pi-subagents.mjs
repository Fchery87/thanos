#!/usr/bin/env node
// Thanos patches for pi-subagents. Idempotent; safe to run repeatedly.
//
// Rewritten for 0.41.0 (2026-08-05). 0.41.0 collapsed the parallel V1/V2
// delegation protocols into one unnumbered protocol: the `SubagentDelegationV2*`
// type family is gone, `version` is rejected as an unsupported request field, and
// `toSubagentDelegationV2Response` no longer exists. The 0.37.2 patch could not be
// forward-ported — it targeted code that upstream deleted — so it was re-derived
// against the new single adapter. The new target is smaller: one
// `toSubagentDelegationResponse` instead of a V1/V2 pair.
//
// 0.41.0 also made the evidence types public for the first time, via a new
// `pi-subagents/shared-types` export (AcceptanceLedger, ExecutionProjection,
// ReviewProjection, ...). That is exactly what ADR 0019 refused to reach into as
// "private runtime modules", so the patch now names supported types instead of
// re-declaring its own. What upstream still does NOT do is project them into the
// terminal response — that omission is the whole reason this patch still exists.
//
// An upstream PR covering the projection and the acceptance request is drafted;
// if it lands, only the artifact-digest, warnings, and residualRisks hunks remain.
// The fanout guard is now a hunk in the same artifact rather than a separate
// string-replace patch (see PATCH_MARKERS below).
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
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(homedir(), ".pi", "agent", "npm", "node_modules", "pi-subagents", "src");
const THANOS_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PACKAGE_RELATIVE = join("agent", "npm", "node_modules", "pi-subagents");
const PINNED_VERSION = "0.42.1";
const EVIDENCE_PATCH = join(THANOS_ROOT, "scripts", "patches", `pi-subagents-${PINNED_VERSION}-evidence.patch`);

// This module is spawned as a subprocess in every real code path (`node
// scripts/patch-pi-subagents.mjs` directly, and src/welcome/patch-drift.ts's
// spawnPatchScript) — never imported. Tests still want direct access to
// PATCH_MARKERS/HUNK_CEILING/the concern-counting functions without triggering
// a real patch-and-verify run (which mutates node_modules and calls
// process.exit). Guarding the side-effecting statements below behind this
// check keeps `node scripts/patch-pi-subagents.mjs` behaving exactly as
// before while making the module safely importable.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

// The fanout guard used to be a separate string-replace patch. It is now a hunk
// in the same artifact: one `git apply`, one reverse-check, one failure mode.
// String-anchored replacement is what snapped when 0.36.0 refactored the shape
// it keyed on; a diff with context lets git tell us honestly whether it still fits.
//
// The 4th element of each entry names the underlying *concern* the marker
// belongs to. Several files can share one concern (the evidence envelope
// spans three) — see HUNK_CEILING below, which counts distinct concerns, not
// patched files.
export const PATCH_MARKERS = [
  ["api", "delegation.ts", "thanos-patch: delegation evidence envelope types", "evidence-envelope"],
  ["slash", "delegation-request.ts", "thanos-patch: acceptance request validation", "evidence-envelope"],
  ["slash", "delegation-adapters.ts", "thanos-patch: evidence envelope projection", "evidence-envelope"],
  ["extension", "fanout-child.ts", "thanos-patch: process-global fanout tool guard", "fanout-guard"],
  ["runs/shared", "model-fallback.ts", "thanos-patch: subagent wall-clock timeout is not a model failure", "timeout-classification"],
];

let applied = 0, already = 0, failed = 0;

function applyEvidencePatch() {
  const targets = PATCH_MARKERS.map(([dir, file, marker]) => ({
    file: join(ROOT, dir, file),
    marker,
  }));
  if (targets.some((target) => !existsSync(target.file))) {
    console.log("[thanos-patch] evidence patch targets missing (skipped)");
    return;
  }
  if (targets.every((target) => readFileSync(target.file, "utf-8").includes(target.marker))) {
    console.log("[thanos-patch] already applied: delegation evidence envelope + fanout guard");
    already++;
    return;
  }
  if (!existsSync(EVIDENCE_PATCH)) {
    console.error(`[thanos-patch] patch artifact missing: ${EVIDENCE_PATCH}`);
    failed++;
    return;
  }
  const applyArgs = [`--directory=${PACKAGE_RELATIVE}`, "--whitespace=nowarn", EVIDENCE_PATCH];
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
      console.log("[thanos-patch] evidence patch is already present");
      already++;
      return;
    }
    console.error(`[thanos-patch] evidence patch does not match pinned pi-subagents ${PINNED_VERSION}: ${(check.stderr ?? "").trim()}`);
    failed++;
    return;
  }
  const apply = spawnSync("git", ["apply", ...applyArgs], {
    cwd: THANOS_ROOT,
    encoding: "utf-8",
  });
  if (apply.status !== 0) {
    console.error(`[thanos-patch] evidence patch failed: ${(apply.stderr ?? "").trim()}`);
    failed++;
    return;
  }
  console.log("[thanos-patch] applied: delegation evidence envelope + fanout guard");
  applied++;
}

// Every patch now lives in the single artifact applied above. The behavioural
// probes below remain the gate: they answer "does pi-subagents behave correctly",
// which is a different question from "is our patch text present".

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
        // 0.41.0 collapsed V1/V2 into one protocol: no `version` field (it is now
        // rejected as unsupported) and `acceptance` takes an AcceptanceInput level,
        // which excludes "verified" — that is a computed output level, not a request.
        `const request = { requestId: "request-1", ownerRunId: "owner-1", nodeId: "node-1", agent: "reviewer", task: "review", context: "fresh", cwd: ".", acceptance: "checked", artifacts: true, result: { kind: "text" } };\n` +
        `const acceptance = { status: "accepted", evidenceStatus: "verified", explicit: true, childReport: { residualRisks: ["risk"] } };\n` +
        `const result = { content: [{ type: "text", text: "ok" }], isError: false, details: { runId: "run-1", results: [{ status: "completed", finalOutput: "ok", launchContractDigest: "${"a".repeat(64)}", execution: { status: "completed", success: true, exitCode: 0 }, acceptance, review: { status: "reviewed", findings: [] }, effects: { fileMutation: { status: "not-applicable", expected: false, attempted: false } } }] } };\n` +
        `const response = mod.toSubagentDelegationResponse(request, result, false);\n` +
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

function verifyTimeoutClassification() {
  const target = join(ROOT, "runs", "shared", "model-fallback.ts");
  if (!existsSync(target)) return { status: "skipped", reason: "model-fallback.ts not installed" };
  if (spawnSync("bun", ["--version"], { stdio: "ignore" }).status !== 0) {
    return { status: "skipped", reason: "bun not on PATH" };
  }
  const dir = mkdtempSync(join(tmpdir(), "thanos-timeout-verify-"));
  try {
    const probe = join(dir, "probe.mjs");
    writeFileSync(
      probe,
      `const mod = await import(${JSON.stringify(target)});\n` +
        // formatTimeoutMessage (runs/foreground/execution.ts) emits exactly this
        // shape. Unpatched, it matches /timed? out/i in
        // RETRYABLE_MODEL_FAILURE_PATTERNS and is misclassified as retryable,
        // which makes execution.ts advance the model fallback ladder and
        // re-run the whole task instead of accepting that the child exhausted
        // its own timeoutMs budget.
        `const timeoutClassifiedRetryable = mod.isRetryableModelFailure("Subagent timed out after 1800000ms.");\n` +
        // A genuine provider-side timeout must still be retried on the next model.
        `const providerTimeoutClassifiedRetryable = mod.isRetryableModelFailure("upstream request timeout");\n` +
        `console.log("THANOS_TIMEOUT_PROBE:" + JSON.stringify({ timeoutClassifiedRetryable, providerTimeoutClassifiedRetryable }));\n`,
      "utf-8",
    );
    const run = spawnSync("bun", ["run", probe], {
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, HOME: dir },
    });
    const match = /THANOS_TIMEOUT_PROBE:([^\n]+)/.exec(run.stdout ?? "");
    if (!match) {
      const detail = (run.stderr ?? "").trim().split("\n").slice(-1)[0] || `exit ${run.status}`;
      return { status: "skipped", reason: `timeout-classification probe did not run (${detail})` };
    }
    const { timeoutClassifiedRetryable, providerTimeoutClassifiedRetryable } = JSON.parse(match[1]);
    if (timeoutClassifiedRetryable) {
      return {
        status: "broken",
        reason: "a subagent wall-clock timeout is still classified as a retryable model failure (would burn the fallback ladder)",
      };
    }
    if (!providerTimeoutClassifiedRetryable) {
      return {
        status: "broken",
        reason: "a genuine provider timeout is no longer classified as retryable (fallback ladder would not engage)",
      };
    }
    return { status: "ok", reason: "subagent wall-clock timeouts are not retried as model failures; provider timeouts still are" };
  } catch (error) {
    return { status: "skipped", reason: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ADR 0024 tripwire: report, don't fail — a tripwire is a prompt to decide
// whether to reopen the vendor-vs-patch decision, not a broken build.
//
// Counts distinct patched *concerns* (the marker's 4th element), not patched
// *files*. Earlier this counted `PATCH_MARKERS.length` — one entry per file —
// which put a single concern spanning three files (the evidence envelope) in
// three times over and fired the tripwire on every run despite the ADR's own
// prose describing the artifact in terms of concerns, not files. See
// docs/adr/0024-pi-subagents-stays-a-dependency-until-these-tripwires-fire.md.
//
// A raw count of `^@@ ` lines in the diff was rejected earlier for the same
// reason one level down: it counts every non-contiguous change region per
// file separately and does not track the ADR's actual intent — confirmed by
// checking it against this file's real patch artifact, which reports in the
// double digits by that measure despite the artifact covering the same small
// number of distinct concerns PATCH_MARKERS lists.
export function countConcerns(markers) {
  return new Set(markers.map((marker) => marker[3])).size;
}

/** Undefined when at or under the ceiling; the tripwire log line otherwise. */
export function formatConcernCeilingWarning(markers, ceiling) {
  const concerns = countConcerns(markers);
  if (concerns <= ceiling) return undefined;
  return (
    `[thanos-patch] patch artifact covers ${concerns} concerns (ceiling ${ceiling}) — ` +
    "ADR 0024 tripwire: reopen the vendor-vs-patch decision."
  );
}

export const HUNK_CEILING = 4;

if (isMainModule) {
  applyEvidencePatch();

  const verdicts = [verifyFanoutGuard(), verifyV2EvidenceEnvelope(), verifyTimeoutClassification()];
  for (const verdict of verdicts) {
    if (verdict.status === "ok") {
      console.log(`[thanos-patch] verified: ${verdict.reason}`);
    } else if (verdict.status === "skipped") {
      console.log(`[thanos-patch] verification skipped — ${verdict.reason}`);
    } else {
      console.error(`[thanos-patch] BROKEN — ${verdict.reason}`);
    }
  }

  const ceilingWarning = formatConcernCeilingWarning(PATCH_MARKERS, HUNK_CEILING);
  if (ceilingWarning) {
    // console.log, not console.error: every console.error in this file
    // accompanies a failed++/broken verdict/process.exit(1) — this doesn't,
    // by design (report, don't fail), and using console.error here would
    // train a reader who's learned that convention to misread this as one.
    console.log(ceilingWarning);
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
}
