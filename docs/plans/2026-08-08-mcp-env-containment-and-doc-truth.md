# MCP Env Containment and Harness Truth Repair Implementation Plan

**Status:** Proposed — not started. Derived from a 2026-08-08 audit of the six
live plan documents, then re-verified line-by-line against the codebase (three
of the audit's own headline findings did not survive that re-verification and
were corrected or dropped; see "What this plan deliberately does not do").

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close a live path that hands every spawned MCP server this machine's
API keys, then make three documents/configs stop describing behaviour the code
does not have, and replace a premature extractor verdict with the measurement
that actually matters.

**Architecture:** Four small, independent repairs plus one investigation. The
security fix wires an allowlist function that already exists (`environmentAllowlist`)
into the one spawn site that ignores it, relying on an existing separation the
codebase already maintains — ambient `process.env` versus explicit per-server
`config.env`, the latter being where `applySecrets` puts credentials. The three
truth repairs delete or correct claims rather than build new mechanisms. The
extractor work deliberately produces no verdict: it defines what a legitimate
observation window is first, because the current data cannot answer the question
it is being asked.

**Tech Stack:** TypeScript (strict-ish; `strict: false`, so no `strictNullChecks`
narrowing on discriminated unions), vitest (`bun run test` — never bare `bun test`,
which selects the wrong runner), `vi.mock` for `node:child_process`.

---

## Context an implementer needs before starting

**This repo is a coding-agent harness.** `src/mcp/` speaks the Model Context
Protocol to servers configured in `mcp.json` files. A **stdio** server is a
local binary this harness spawns as a child process. An **http/sse** server is
reached over the network and spawns nothing — every task below that touches
spawning concerns stdio only.

**Two independent env channels already exist, and the distinction is the whole
basis of Task 1:**

1. `config.env` — explicit, per-server, from `mcp.json`. `applySecrets`
   (`src/mcp/manager.ts:59-68`) merges that server's stored credentials into it.
   This is deliberate consent: "this server gets this value."
2. `process.env` — this machine's whole ambient environment, currently passed
   wholesale at `src/mcp/client.ts:55` via `{ ...process.env, ...env }`.

Channel 2 is the leak. Verified on this machine: `GEMINI_API_KEY`,
`GOOGLE_API_KEY`, and `THECLAWBAY_API_KEY` are all present in `process.env` and
all currently reach every spawned stdio MCP server, regardless of whether that
server has any business with them.

**Why the trust gate does not already cover this.** `evaluateMcpTrust`
(`src/mcp/trust.ts:71`, wired at `src/mcp/manager.ts:308`) does gate *whether* a
server may run. But "I approved this binary to run" and "I gave this binary my
Gemini key" are separable consents, and only the first is currently asked for.

**Why this was not simply forgotten.** `docs/plans/2026-07-27-harness-simplification-plan.md`
Phase 5 contains exactly three tasks (5.1 wire `validation.ts`, 5.2 wire
`evaluateMcpTrust`, 5.3 hostile-server test). `environmentAllowlist` appears
once, at line 417, in an *inventory* of unwired functions — no task ever
scheduled it. That plan's "Unwired security modules | 2 | 0" metric counts
**modules** (`trust.ts`, `validation.ts`), and both do now have importers, so
the metric is satisfied and this is genuinely new work, not unfinished work.

---

## Task 1: Contain the environment spawned MCP servers inherit

**Priority: do this first.** It is the only task here with a live security
consequence.

**Files:**
- Modify: `src/mcp/client.ts` (imports at `:1-6`; the `connect()` spawn at `:50-57`)
- Test: `tests/mcp/client.test.ts` (existing `StdioMCPClient` suite begins `:82`)

**Background for this task.** `environmentAllowlist`
(`src/mcp/trust.ts:97-100`) already exists and returns exactly:

```ts
["PATH", "HOME", "USER", "TMPDIR", "TEMP", "TMP"]
```

It takes an `McpServerIdentity` and currently ignores it (`_identity`). Keep the
signature as-is — a future per-server allowlist is the obvious reason it takes
the parameter, and changing the signature now is scope creep with no caller
asking for it.

**Step 1: Write the failing test**

Add to `tests/mcp/client.test.ts`, inside the existing `describe("StdioMCPClient", ...)`
block (near the existing env test at `:95`, which asserts `config.env` merging
and must keep passing):

```ts
it("does not leak ambient secrets from process.env into the spawned server", async () => {
  process.env.THANOS_TEST_SECRET = "super-secret-value";
  try {
    const config = { command: "srv", args: [], env: { MY_VAR: "hello" } };
    const client = new StdioMCPClient(config, opts);
    await client.connect();

    const [, , spawnOpts] = mockSpawn.mock.calls[0]!;
    const env = spawnOpts.env as Record<string, string>;

    // The explicit per-server value still arrives — this is the consent channel
    // applySecrets() uses for credentials, and it must not be filtered.
    expect(env.MY_VAR).toBe("hello");
    // The allowlisted ambient value still arrives — servers need to find binaries.
    expect(env.PATH).toBe(process.env.PATH);
    // The ambient secret does NOT.
    expect(env.THANOS_TEST_SECRET).toBeUndefined();
  } finally {
    delete process.env.THANOS_TEST_SECRET;
  }
});
```

Note: `mockSpawn` and `opts` are already defined in this file's setup (see
`:44-48` and the `beforeEach`). Reuse them; do not build a second harness.

**Step 2: Run it and confirm it fails**

```bash
bunx vitest run tests/mcp/client.test.ts
```

Expected: FAIL on `expect(env.THANOS_TEST_SECRET).toBeUndefined()` — received
`"super-secret-value"`, because `{ ...process.env }` copies it in today.

**Step 3: Implement**

In `src/mcp/client.ts`, add to the existing import block:

```ts
import { environmentAllowlist, normalizeIdentity } from "./trust";
```

Add this helper above `class StdioMCPClient` (around `:36`):

```ts
/**
 * The ambient environment a spawned stdio MCP server inherits, reduced to the
 * allowlist.
 *
 * Two env channels reach a server and only one of them is consent. `config.env`
 * is explicit and per-server — it is where `applySecrets` (manager.ts) puts that
 * server's own credentials — so the caller spreads it over this result and it is
 * deliberately NOT filtered here. `process.env` is ambient: it carries this
 * machine's unrelated API keys, which an approved server has no claim to.
 * Approving a binary to run is not the same act as handing it every credential
 * the operator happens to hold.
 */
function inheritedEnv(config: MCPServerConfig): Record<string, string> {
  const allowed = environmentAllowlist(normalizeIdentity({
    type: config.type ?? "stdio",
    command: config.command,
    args: config.args,
    url: config.url,
  }));
  const inherited: Record<string, string> = {};
  for (const key of allowed) {
    const value = process.env[key];
    if (value !== undefined) inherited[key] = value;
  }
  return inherited;
}
```

Then change the spawn at `:53-56` from:

```ts
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...process.env, ...env },
      });
```

to:

```ts
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "ignore"],
        env: { ...inheritedEnv(this.config), ...env },
      });
```

**Step 4: Run the tests**

```bash
bunx vitest run tests/mcp/client.test.ts
```

Expected: PASS, including the pre-existing `:95` test (it uses `toMatchObject`
on `{ MY_VAR: "hello" }`, which comes through `config.env` and is unaffected).

Then the surrounding suites, since MCP touches lifecycle and hostile-server paths:

```bash
bunx vitest run tests/mcp/
```

**Step 5: Verify nothing depended on the wide env**

`environmentAllowlist` omits `SHELL`, `LANG`, `NODE_ENV`, proxy variables, and
everything else. Confirm the MCP servers actually configured on this machine
still connect:

```bash
grep -rl '"mcpServers"' ~/.pi ~/.config 2>/dev/null | head
```

If a real server needs a variable the allowlist omits, the correct fix is to add
it explicitly to that server's `env` block in its `mcp.json` (the consent
channel), **not** to widen the allowlist — widening it re-opens this hole for
every server at once. If a variable is genuinely needed by *all* servers (a
corporate `HTTPS_PROXY`, say), add it to `environmentAllowlist` in
`src/mcp/trust.ts:97` and say why in a comment.

**Step 6: Full gate, then commit**

```bash
bun run typecheck && bun run lint && bun run test
```

```bash
git add src/mcp/client.ts tests/mcp/client.test.ts
git commit -m "fix(mcp): stop handing every spawned server this machine's environment"
```

---

## Task 2: Delete the completed spec-verification plan

**Files:**
- Delete: `docs/plans/2026-07-26-spec-verification-evidence-plane-plan.md`
- Modify: `docs/adr/0006-completion-verification-gate.md` (only if Step 2 finds a gap)

**Why.** All ten of its tasks are implemented and merged (PR #47, squash commit
`3493e38`). It carries no `**Status:**` line because it self-reports via a
hand-written "Honest completion ledger" instead — which is why it never got
swept up as done. This repo's convention
(`docs/plans/2026-07-27-harness-simplification-plan.md:471-473`) is that
`docs/plans/` holds live plans only, and a completed one is deleted on
completion with its durable content moved to an ADR.

**Step 1: Re-verify completion before deleting anything**

Do not take the above on faith — deletion is the one irreversible step here
(recoverable from git, but still).

```bash
cd /home/nochaserz/.pi
for f in src/spec/command-normalize.ts src/spec/diff-evidence.ts \
         src/spec/extractor.ts src/spec/extractor-prompt.ts \
         tests/spec/evidence-seam.test.ts; do
  [ -f "$f" ] && echo "EXISTS: $f" || echo "MISSING: $f"
done
for f in src/runtime/continuation-arbiter.ts src/spec/evaluator.ts; do
  [ -f "$f" ] && echo "STILL PRESENT (task 2 incomplete): $f" || echo "deleted OK: $f"
done
grep -rn "rejectActiveSpec" src/ --include="*.ts"
bunx vitest run tests/spec/evidence-seam.test.ts
```

Expected: all five EXIST, both correctly deleted, `rejectActiveSpec` defined at
`src/spec/engine.ts` and called from `src/runtime/work-contract-approval.ts`,
and the seam test passing (17 tests).

**If anything fails here, stop and revise this task** — the plan is not
complete and must not be deleted.

**Step 2: Check whether any durable content would be lost**

```bash
grep -rn "2026-07-26-spec-verification-evidence-plane-plan" \
  --include="*.ts" --include="*.mjs" --include="*.md" . | grep -v "^./docs/plans/2026-07-26"
```

Any hit is a dangling reference to fix in the same commit. The plan's durable
decisions already live in `docs/adr/0006-completion-verification-gate.md` and in
the inline rationale comments across `src/spec/`; the per-task commit ledger it
carries is reachable via tag `pre-squash/pr-47`. Only fold something into ADR
0006 if Step 2 surfaces a decision that exists *nowhere else*.

**Step 3: Delete and commit**

```bash
git rm docs/plans/2026-07-26-spec-verification-evidence-plane-plan.md
git commit -m "docs: delete the completed spec-verification evidence plane plan"
```

---

## Task 3: Make `docs/governance.md` stop claiming modes pin a policy preset

**Files:**
- Modify: `docs/governance.md:84` and the mode table at `:86-90`

**The gap.** `docs/governance.md:84` states *"Each mode pins a base policy
preset and shapes what `/ship` does,"* and the table below it maps
`local-only → personal`, `direct-PR → team`, `no-mistakes → ci`. That mapping is
implemented by `presetForMode` (`src/governance/delivery-overlay.ts:109`), which
has **zero production callers** — only its own test
(`tests/governance/delivery-overlay.test.ts`). What *is* live is
`deliveryPolicyOverlay` (same file, `:58`), called from
`src/runtime/governance-runtime.ts:58`, which adds per-mode **deny rules** on
top of whatever preset is already active. Adding deny rules is not pinning a
base preset.

**Decision: correct the document, do not wire the function.** Wiring
`presetForMode` would silently change the effective policy for every already-
registered `direct-PR` and `no-mistakes` repo that has no `harness.policy.json`
of its own — a behaviour change to live governance, arriving as a side effect of
a documentation fix. That needs its own deliberate decision with its own
testing, and nobody has asked for it. This task makes the document true about
today's code; it does not decide the larger question.

**Step 1: Fix the prose at `:84`**

Replace:

```markdown
A **delivery mode** decides how far a repo's work is allowed to travel and how autonomously Thanos may act in it. Each mode pins a base policy preset and shapes what `/ship` does.
```

with:

```markdown
A **delivery mode** decides how far a repo's work is allowed to travel and how autonomously Thanos may act in it. Each mode contributes a set of deny rules to the active policy ceiling (`deliveryPolicyOverlay`, `src/governance/delivery-overlay.ts:58`) and shapes what `/ship` does. A mode does **not** select the base policy preset — the preset comes from `harness.policy.json`, or the built-in default when a repo has none.
```

**Step 2: Fix the table's preset column**

The table at `:86-90` currently reads its second column as the preset a mode
pins. Retitle that column and state what the mode actually contributes. The
`presetForMode` mapping still exists as an *unused intention*, so do not present
it as behaviour. Replace the column header `| Preset |` with `| Adds |` and each
cell with the overlay's actual effect for that mode — read
`deliveryPolicyOverlay` (`src/governance/delivery-overlay.ts:58-106`) and
describe the rules it returns for each of the three modes, rather than copying
this plan's guess.

**Step 3: Decide `presetForMode`'s fate in the same commit**

It is now provably dead code with a passing test asserting behaviour nothing
uses. Two acceptable outcomes — pick one and say why in the commit message:

- **Delete it and its test.** Correct if nobody intends to wire it. Cleanest.
- **Keep it and add a one-line comment above it** saying it is a documented
  intention that is deliberately not wired, and pointing at this task. Correct
  if the mode→preset link is still wanted later.

Do not leave it as-is, unexplained — that is the state that produced this bug.

**Step 4: Verify and commit**

```bash
bun run test && bun run lint
```

```bash
git add docs/governance.md src/governance/delivery-overlay.ts tests/governance/delivery-overlay.test.ts
git commit -m "docs(governance): a delivery mode adds deny rules, it does not pin a preset"
```

---

## Task 4: Resolve designer's delegation contradiction

**Files:**
- Modify: `src/agents/catalog.ts:100` (designer `toolCeiling`)
- Modify: `agent/agents/designer.md:137` (and `:75-84` if wording needs to follow)
- Test: `tests/agents/catalog.test.ts`

**The contradiction.** `src/agents/catalog.ts:100` lists `"subagent"` in
designer's `toolCeiling`, but `:97` sets `mayDelegate: NO_DELEGATION`. Those
cannot both be acted on: `src/agents/manifest.ts:36-38` throws
`designer declares unsupported delegation tool "subagent"` for any manifest that
declares `subagent` while `mayDelegate` is empty. So the `toolCeiling` entry is
unreachable — a grant that can never be exercised.

**The no-delegation stance is deliberate, not an accident.** Eight of the
catalog's agents carry `NO_DELEGATION`, and `tests/agents/catalog.test.ts:109`
explicitly asserts *"designer and worker cannot delegate."* **Do not restore
delegation** — that would overturn tested policy to satisfy a prompt.

**The downstream symptom.** `agent/agents/designer.md:137` calls the Playwright
click-test *"a **required gate**, run via the delegated subagent — not
optional,"* while `:84` already provides a graceful-degradation path for when no
subagent can be spawned. Since delegation is *never* available, the degradation
path is the only reachable one, and `:137` describes a gate that can never fire.

**Step 1: Remove the unreachable grant**

In `src/agents/catalog.ts:100`, drop `"subagent"`:

```ts
      toolCeiling: ["read", "ls", "find", "grep", "write", "edit", "web_search", "fetch_content"],
```

**Step 2: Pin the constraint with a test**

`tests/agents/catalog.test.ts` currently proves designer cannot delegate only
indirectly, via `mayDelegateTo`. Add a direct assertion that the ceiling and the
delegation stance agree, so this cannot silently drift apart again:

```ts
it("designer's toolCeiling does not offer a delegation tool it may never use", () => {
  const profile = getSpecialist("designer")!;
  expect(profile.mayDelegate).toHaveLength(0);
  expect(profile.toolCeiling).not.toContain("subagent");
});
```

`getSpecialist` is already imported at the top of `tests/agents/catalog.test.ts`
(it returns `SpecialistProfile | undefined`, hence the `!`). No new import needed.

Consider asserting this for **every** profile rather than designer alone — the
same contradiction can appear on any of the eight `NO_DELEGATION` agents:

```ts
it("no agent offers subagent in its ceiling while forbidden from delegating", () => {
  for (const profile of allSpecialists()) {
    if (profile.mayDelegate.length === 0) {
      expect(profile.toolCeiling).not.toContain("subagent");
    }
  }
});
```

`allSpecialists` is also already imported. **Prefer this second form** — it was
checked against all 14 profiles while writing this plan and designer is the
*only* violation. Every other agent is already consistent: the six that may
delegate (`build`, and the five `reviewer-*`) all carry `subagent` in their
ceiling, and the seven others that may not (`explore`, `plan`, `oracle`,
`researcher`, `evaluator`, `scout`, `worker`) all correctly omit it. So this
assertion goes green the moment Step 1 lands, and thereafter pins a real
repo-wide invariant rather than one agent's quirk.

**Step 3: Make the prompt describe what the agent can actually do**

In `agent/agents/designer.md:137`, the click-test can no longer be called a
required gate run via a delegated subagent. Rewrite it so the *verification
standard* survives while the *mechanism* becomes honest — the degradation path
at `:84` is the real behaviour, and `:84`'s own rule ("do not claim visual
success", emit the exact commands, flag `visual verification NOT performed`) is
the contract to point at. Keep the demand for honesty; drop the promise of a
mechanism that cannot fire.

Re-read `:75-84` and `:158` after editing — they also reference delegating
execution, and the whole section should tell one consistent story rather than
three.

**Step 4: Verify the agent still loads**

```bash
bunx vitest run tests/agents/
bun run test
```

Expected: green. A malformed `designer.md` fails manifest validation loudly, so
a passing `tests/agents/` run is real evidence the frontmatter still parses.

**Step 5: Commit**

```bash
git add src/agents/catalog.ts agent/agents/designer.md tests/agents/catalog.test.ts
git commit -m "fix(agents): designer stops advertising a delegation path it cannot use"
```

---

## Task 5: Settle the extractor's observation-window semantics — produce no verdict

**Files:**
- Modify: `src/spec/extractor-decision.ts` (doc comment on `ObservationWindow`, `:83-92`)
- Create: `scripts/extractor-decision.mjs`
- Modify: `docs/adr/0006-completion-verification-gate.md` (only at Step 5, and only to record semantics)

**Do not record a `keep` or `delete` verdict in this task.** That is the whole
point of it.

**Why the pending verdict is not trustworthy.** Running the real
`decideExtractorFate()` over every ledger on this machine produces *different
verdicts depending on a window field nobody has defined*:

| Window `repository` | qualifying | acceptRate | verdict |
|---|---|---|---|
| aggregate, non-matching | 29 | 65.5% | `inconclusive` |
| `/home/nochaserz/.pi` | 33 | 69.7% | `keep` |
| `.../Coding Projects/Alora` | 29 | 65.5% | `inconclusive` |

The swing is an artifact, not a signal: **131 of the rows carry no `repository`
field at all**, and `classifyRow` (`src/spec/extractor-decision.ts:154-156`)
only rejects on `scope_mismatch` when the field is *present* and differs. So
those 131 rows count toward **every** scope simultaneously, and the 30-sample
threshold gets crossed or not depending on which repo's ~29 scoped rows happen
to be added to them. A threshold that a fabricated window field can flip is not
yet a decision procedure.

Also note: a run requires `revision` and `contractSchemaDigest`, and there is no
documented source for either. Any verdict recorded today rests on invented
inputs.

**Step 1: Document what a legitimate window is**

Extend the doc comment on `ObservationWindow` (`src/spec/extractor-decision.ts:83`)
to answer, in prose, the three questions a caller cannot currently answer:

- Is a window **per-repository** or **global**? If per-repository, say
  explicitly that rows without a `repository` field are legacy rows that predate
  scoped emission and state whether they may be counted (recommended: they may
  not — a row that counts toward every scope at once cannot support a
  per-repository verdict).
- Where do `revision` and `contractSchemaDigest` come from? Name the command or
  source, or state that a window spanning multiple revisions/digests is
  permitted and what that costs.
- What bounds `start`/`end`? An unbounded window mixes pre- and post-repair
  extraction behaviour, which is exactly what the 2026-07-27 amendment's pinned
  threshold was meant to prevent.

**Step 2: Consider rejecting unscoped rows**

If Step 1 concludes windows are per-repository, then `classifyRow` should
reject rows with no `repository` field under a new
`RowRejectionReason` (e.g. `"unscoped"`), rather than silently counting them
everywhere. That is a behaviour change with tests — write the failing test
first:

```ts
it("does not count a row with no repository toward a scoped window", () => {
  const record = decideExtractorFate({
    window: { /* ...a scoped window... */ },
    rows: [/* one qualifying row with no repository field */],
  });
  expect(record.qualifyingTotal).toBe(0);
  expect(record.rejectionReasons.unscoped).toBe(1);
});
```

Only do this if Step 1 concluded per-repository. If it concluded global, skip to
Step 3 and say so in the commit message.

**Step 3: Ship a repeatable runner instead of an ad-hoc script**

Create `scripts/extractor-decision.mjs` so this decision is reproducible by
anyone, rather than reconstructed from scratch every time (this audit had to
write a throwaway script twice). It should:

- discover ledgers (`find` for `*/.harness/evolution/events.jsonl`),
- build a window from real inputs per Step 1 (accept `--repository`, `--since`, `--until`),
- call the real `readExtractionLedgerRows` + `decideExtractorFate` — never
  re-implement the counting, which is exactly how the audit that preceded this
  plan got the wrong number by grepping the `outcome` field, when
  `outcomeFromSummary` (`:117-121`) actually parses the outcome out of `summary`,
- print the full `ExtractorDecisionRecord`, including `rejectionReasons`.

Add `"extractor-decision": "bun scripts/extractor-decision.mjs"` to
`package.json` scripts.

**Step 4: Investigate the timeout rate — this is the real finding**

Across all ledgers the outcome counts are `timeout: 125`, `accepted: 23`,
`schema_rejected: 10`, `provider_error: 2`. **The extractor times out on roughly
78% of the invocations it logs.** Timeouts are excluded from the qualifying
denominator by design (`QUALIFYING_OUTCOMES`, `:15`), so the accept rate is
computed over the ~22% of calls that returned anything at all — which is why
optimising for accept rate is the wrong instinct here.

`DEFAULT_TIMEOUT_MS = 10_000` (`src/spec/extractor.ts:17`), overridable via
`spec.timeoutMs` in `agent/settings.json` (`:49`). Determine, and record:

- Is 10s simply too short for the configured extraction model? Compare against
  the model's typical latency for a prompt of this size.
- Do timeouts correlate with a particular model? Rows carry an optional `model`
  field (`ExtractionLedgerRow`, `:71`) — check whether it is populated, and if
  not, populating it is a prerequisite to answering this at all.
- Is the timeout wasted work? At `:140` a timeout resolves `undefined` and the
  deterministic contract stands, so a turn still proceeds — the cost is latency
  and an unused model call, not a broken turn. Quantify it before treating it as
  urgent.

A 78% timeout rate plausibly means the accept-rate question has been measured on
a badly unrepresentative sample the whole time. Resolve this **before** the
threshold is treated as meaningful.

**Step 5: Record semantics — not a verdict — in ADR 0006**

Amend `docs/adr/0006-completion-verification-gate.md` with what Step 1 settled
and what Step 4 measured. The existing 2026-08-03 amendment (`:63-78`) already
says the question is "unresolved, not closed" and commits to amending again
"once 30 qualifying outcomes exist." Add that a qualifying count is only
meaningful once the window is defined, and record the timeout rate as a
precondition on the whole measurement.

**Step 6: Verify and commit**

```bash
bun run typecheck && bun run lint && bun run test
```

```bash
git add src/spec/extractor-decision.ts scripts/extractor-decision.mjs package.json \
        docs/adr/0006-completion-verification-gate.md tests/spec/
git commit -m "fix(spec): define the extractor observation window before trusting its verdict"
```

---

## Sequencing

| Task | Depends on | Why |
|---|---|---|
| 1 — MCP env containment | — | Live secret exposure; do first |
| 2 — delete completed plan | — | Independent, near-zero risk |
| 3 — governance.md truth | — | Independent |
| 4 — designer cleanup | — | Independent |
| 5 — extractor semantics | — | Independent, largest, produces no verdict |

All five are independent and can land in any order or in parallel worktrees.
Gate for each: `bun run typecheck && bun run lint && bun run test` green.

---

## What this plan deliberately does not do

- [ ] **NOT restoring designer's delegation.** `mayDelegate: NO_DELEGATION` is
      deliberate, shared by eight agents, and asserted by
      `tests/agents/catalog.test.ts:109`. Task 4 removes the unreachable grant
      and fixes the prompt; it does not overturn tested policy.
- [ ] **NOT wiring `presetForMode`.** It would silently change effective policy
      for already-registered repos with no `harness.policy.json`. Task 3 makes
      the document true; the mode→preset question stays open and deliberate.
- [ ] **NOT recording an extractor `keep`/`delete` verdict.** The current data
      yields different verdicts depending on an undefined window field. Task 5
      defines the semantics; the verdict comes later, from real inputs.
- [ ] **NOT widening `environmentAllowlist` to fix a broken server.** A server
      needing an extra variable gets it in its own `mcp.json` `env` block — the
      consent channel. Widening the allowlist re-opens the hole for every server.
- [ ] **NOT building `/goal --max-turns N`.** `docs/plans/2026-07-22-harness-speed-and-spec-gate-fix-plan.md`
      describes it, but `goal.maxTurns` is already configurable in
      `agent/settings.json` (`0` = unlimited), so the flag is convenience only —
      and that plan's own purpose was cutting the ceiling 200→25, which an easy
      per-invocation override partly undermines.
- [ ] **NOT changing `defaultThinkingLevel`.** It reads `"max"` rather than the
      `"medium"` that same plan claims it set, but `agent/settings.json` is
      gitignored, user-owned config and max-thinking is a deliberate operator
      preference. Not drift to correct.
- [ ] **NOT reconciling the two competing permission-surface designs.**
      `2026-07-21-permission-modes-design.md` (single `permissionMode` enum) and
      `2026-07-23-permission-surface-2axis-design.md` (posture × containment)
      are both unbuilt — verified: zero target symbols, registry still
      `Type.Literal(1)`. Picking one is a design decision, not cleanup, and does
      not belong in this plan.
