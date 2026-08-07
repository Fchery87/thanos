# pi-subagents 0.41.0 → 0.42.1 patch-anchor port matrix

**Date:** 2026-08-07
**Method:** `npm pack pi-subagents@0.42.1`, extracted and diffed against the pristine `pi-subagents@0.41.0` devDependency (`node_modules/pi-subagents`), file by file, for each of the five files `PATCH_MARKERS` (`scripts/patch-pi-subagents.mjs`) anchors to. Cross-checked against upstream's own `CHANGELOG.md` for 0.42.0 and 0.42.1. Empirically verified by applying the real `scripts/patches/pi-subagents-0.41.0-evidence.patch` artifact — unmodified — to a real, freshly extracted 0.42.1 source tree via `git apply`.

## A note on the diff process itself

Before running the real comparison, the first pass produced a false anchor difference: this repo's pristine `node_modules/pi-subagents` copy (both in the main checkout and this worktree) had one stray line — `// thanos-patch: PROBE MARKER` — appended to `src/extension/fanout-child.ts`. This traced to an earlier same-session experiment (verifying whether a same-version reinstall wipes patched files) that appended a marker to a scratch-directory install; bun's global package cache hardlinks installed files from its cache, so that mutation propagated into the cache entry for `pi-subagents@0.41.0` itself, and from there into every subsequent install of that exact version on this machine, including the "pristine" devDependency copies used as ground truth here.

Remediated by deleting the corrupted cache entry (`~/.bun/install/cache/pi-subagents@0.41.0@@@1`) and reinstalling fresh in both the main repo and this worktree. Verified clean afterward (zero `thanos-patch`/marker strings anywhere in the reinstalled pristine tree) and confirmed no other files were affected. The live, patched runtime install at `agent/npm/node_modules/pi-subagents` was never contaminated — only the unpatched devDependency copies used for hermetic testing and this research were affected, and only that one file. All diffs and conclusions below are against the verified-clean copy.

## Per-marker verdict

All five `PATCH_MARKERS` targets are **byte-identical** between 0.41.0 and 0.42.1. `diff -u` against each produced no output for any of the three concerns:

| Concern | Files | Diff 0.41.0 → 0.42.1 |
|---|---|---|
| `evidence-envelope` | `src/api/delegation.ts`, `src/slash/delegation-request.ts`, `src/slash/delegation-adapters.ts` | none |
| `fanout-guard` | `src/extension/fanout-child.ts` | none |
| `timeout-classification` | `src/runs/shared/model-fallback.ts` | none |

**Verdict for all three concerns: still needed, anchor intact — no re-derivation required at all.** This is a stronger result than the plan's three anticipated outcomes (absorbed / re-derive-mechanically / re-derive-from-scratch) allowed for: since the anchor files themselves did not change, the existing patch artifact is not being *re-applied against a shifted anchor* — it is applying against the exact same text it was originally cut against.

Confirmed empirically, not just inferred from the empty diffs: `git apply --check --whitespace=nowarn scripts/patches/pi-subagents-0.41.0-evidence.patch` against a real, freshly extracted 0.42.1 source tree exits 0 with no output. Applied for real (not `--check`) against the same tree and confirmed all five `thanos-patch` markers land exactly where expected in all five files.

## Why nothing changed, per upstream's own changelog

Cross-checked against `CHANGELOG.md` in the 0.42.1 package. The 0.42.0 and 0.42.1 entries cover: terminal widget/overlay crash fixes in narrow layouts, async scripted-workflow timeout behavior, `workflowScript` chat progress projections, managed worktree isolation for scripted workflows, `@gotgenes/pi-permission-system` compatibility, MCP adapter cache identity matching, Herdr inspector bootstrapping, and install/audit hygiene. None of these entries touch delegation request/response handling, the evidence envelope, fanout child registration, or model-fallback timeout classification — consistent with, and independently corroborating, the empty file diffs above. (Durable schedules, mentioned in an earlier draft of this note, is a 0.41.0 feature — the pinned baseline itself, not a 0.42.x change; corrected here after independent review caught the misattribution.)

## Consequence for Task 1.2

Task 1.2 ("cut and verify the 0.42.1 artifact") reduces to: bump `PINNED_VERSION` and the five other version declarations, rename the patch artifact file (`pi-subagents-0.41.0-evidence.patch` → `pi-subagents-0.42.1-evidence.patch`), and copy its contents unchanged — there is no diff to re-derive. The behavior verifiers (`verifyFanoutGuard`, `verifyV2EvidenceEnvelope`, `verifyTimeoutClassification`) still need to run against the newly-cut artifact as the actual gate, per the plan's own standing rule that behavior is what's trusted, not text — but no hunk content changes are expected to be necessary.

No ADR 0024 tripwire fired during this research: no anchor was deleted upstream (tripwire #1 does not apply), and the concern count remains 3 against the recalibrated ceiling of 4 (Task 1.0; tripwire #2 does not re-fire).
