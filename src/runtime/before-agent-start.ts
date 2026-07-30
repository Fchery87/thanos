import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalController } from "../goal/controller";
import type { SpecEngine } from "../spec/engine";
import { snapshotWorkingTree } from "../spec/diff-evidence";
import type { ContractExtractor } from "../spec/extractor";
import type { LensLite } from "../lens/lite";
import type { MemoryRecord } from "../memory/types";
import type { PermissionManager } from "../permissions/manager";
import { computeThinkingEscalation, NO_ESCALATION, type ThinkingEscalationState } from "./thinking-escalation";
import { getSupportedLevels, setThinkingStatus, type ThinkingLevel } from "./thinking-levels";
import { buildGoalSystemPrompt } from "../goal/prompts";
import { loadRoster, formatRoster } from "../agents/roster";
import { assemblePrompt } from "../context/broker";
import { assembleSystemPrompt } from "./prompt-assembly";
import { consumeContinuation } from "./continuation-auth";
import { projectMemory } from "./commands/memory";

// ── Auto-invoke: keep the top-level agent inline-first ──
// Parent only — children must not recursively fan out. The per-agent
// `description` frontmatter (~/.pi/agent/agents/*.md) is the routing signal,
// so the roster is injected here verbatim instead of instructing the model
// to call `subagent {action:"list"}` — that instruction made it re-list the
// roster on every prompt, burning ~700 transcript tokens per turn for
// information that is static within a session.
//
// The directive is inline-FIRST on purpose: a specialist run spins up a
// fresh cold-started child (seconds of startup, often minutes of wall-clock),
// so reflexively delegating ordinary work makes the session slower, not
// smarter. Delegate only when it genuinely pays.
export const TRUSTED_INSTRUCTIONS: readonly string[] = [
  "Specialist subagents are available via the `subagent` tool.",
  "Do non-trivial work inline yourself by default — you are a capable generalist and inline work has no cold-start cost. Delegate to a specialist ONLY when the work is genuinely parallel (independent slices worth running at once), needs a capability you lack, or the user explicitly asked for deep review or /waves. A specialist run cold-starts a fresh child (seconds to load, often minutes of wall-clock), so reflexive delegation of ordinary work makes the session slower, not smarter.",
  "When you do delegate independent or pipelined tasks, use the parallel/chain modes.",
  "Read-only specialists cannot edit or run commands by design.",
  "Do NOT pass timeoutMs/maxRuntimeMs when delegating — every agent has its own maxExecutionTimeMs budget, and short caller timeouts kill healthy runs mid-flight, wasting all their work. If you must bound a run, use at least 600000 (10 minutes).",
];

// ── Auto-invoke: nudge the top-level agent to reach for skills ──
// Pi core injects an <available_skills> block into the system prompt but only
// softly ("use the read tool when it matches"). Non-Claude models routinely
// ignore that hint, so restate it as a hard directive. Parent only — subagents
// receive their curated skill set via pi-subagents.
//
// Exported alongside TRUSTED_INSTRUCTIONS so scripts/measure-harness.mjs weighs
// the real per-turn prompt rather than a copy that drifts out of date.
export const SKILLS_DIRECTIVE =
  "Specialized skills are listed in the <available_skills> block of this " +
  "system prompt. Before doing non-trivial work, scan that block: if any " +
  "skill's description matches the task, `read` its SKILL.md file FIRST and " +
  "follow its instructions — do not improvise work a skill already covers. " +
  "A skill gives you a procedure to run inline; by default run it inline " +
  "yourself. Delegating skill-guided work to a subagent is only worth the " +
  "cold-start when the work is independent/parallel or genuinely needs fresh context.";

export interface BeforeAgentStartDeps {
  sessionId: string;
  isSubagent: boolean;
  permissions: PermissionManager;
  spec: SpecEngine;
  lens: LensLite;
  goalController: GoalController;
  /** Receives the live ExtensionContext each turn; omitted in tests. */
  contractExtractor?: ContractExtractor;
}

/**
 * before_agent_start: spec classification + session reset on each prompt,
 * the thinking-level escape hatch for /goal + --spec, hand-curated memory
 * injection, the specialist-roster directive, the skills-usage nudge, and
 * the active-goal persistence directive — folded together with Pi's base
 * prompt via assembleSystemPrompt (cached static prefix + uncached dynamic
 * tail).
 */
export function registerBeforeAgentStart(pi: ExtensionAPI, deps: BeforeAgentStartDeps): void {
  const { sessionId, isSubagent, permissions, spec, lens, goalController, contractExtractor } = deps;

  // Thinking escape hatch: /goal and --spec run at the model's max, restored when
  // neither is active. State persists across turns (parent session only) — this
  // handler is the only place that reads or writes it, so it lives here rather
  // than in the registerHarness() closure.
  let thinkingEscalation: ThinkingEscalationState = NO_ESCALATION;

  // Snapshot the roster ONCE per session, not per turn. loadRoster() reads
  // mutable user/project agent files from disk; awaiting it every turn means
  // an in-session edit to those files would change the "session-static" roster
  // block and bust the very prompt-cache prefix stability this whole path
  // exists to protect. registerBeforeAgentStart runs once per registration
  // (= once per session), so this promise is created once and awaited lazily
  // on each turn below.
  const sessionRoster = isSubagent ? Promise.resolve([]) : loadRoster();

  pi.on("before_agent_start", async (event, ctx) => {
    ctx.ui.setHeader(undefined);
    permissions.clearSessionRules();  // clear deny rules from any prior rejection
    const isHarnessContinuation =
      consumeContinuation(sessionId, "spec", event.prompt) ||
      consumeContinuation(sessionId, "goal", event.prompt) ||
      consumeContinuation(sessionId, "waves", event.prompt);
    if (!isHarnessContinuation) {
      // Hand the extractor this turn's model + registry before generation kicks
      // it off. Without a context it degrades to deterministic-only.
      contractExtractor?.setContext(ctx);
      spec.startTurn(event.prompt, pi.getFlag("spec") === true);
      // Working-tree state before this turn touches anything, so agent_end can
      // tell what this turn changed from what was already dirty. Kept as an
      // unawaited promise: the turn pays no latency for it, and it is only read
      // at agent_end. Continuation turns deliberately keep the original
      // baseline — evidence accumulates across gate attempts.
      spec.turnBaseline = snapshotWorkingTree(process.cwd()).catch(() => undefined);
    }
    lens.beginTurn();
    lens.setStatus(ctx);

    // ── Thinking escape hatch: /goal and --spec run at the model's max ──
    // Parent only. High-assurance work overrides the medium default and restores
    // the user's baseline the moment neither a goal nor --spec is active.
    if (!isSubagent) {
      const model = ctx.model;
      const supportedLevels = model?.reasoning ? getSupportedLevels(model) : [];
      const escalation = computeThinkingEscalation({
        active: goalController.snapshot()?.status === "active" || pi.getFlag("spec") === true,
        supportedLevels,
        current: pi.getThinkingLevel() as string | undefined,
        state: thinkingEscalation,
      });
      thinkingEscalation = escalation.state;
      if (escalation.setLevel !== undefined) {
        pi.setThinkingLevel(escalation.setLevel as ThinkingLevel);
        setThinkingStatus(pi, ctx);
      }
    }

    // ── Memory: inject hand-curated preferences ────────────────────
    // Read-only: entries come from deliberate edits to .harness/memory.json,
    // never from auto-capture. The old prompt-pattern capture path memorized
    // any prompt containing "do not" as a durable preference and replayed it
    // into later sessions — including a parent's "just delegate to the
    // reviewer", which caused reviewer→reviewer recursion in children.
    // Parent sessions only: a subagent's context is its task, not the
    // parent project's preference list.
    let memories: MemoryRecord[] = [];
    if (!isSubagent) {
      const { store, project } = projectMemory();
      memories = store.query({ project, limit: 10 });
    }

    // Model router removed — /models command handles model selection

    // Roster and memories are still rendered by assemblePrompt (broker) /
    // formatRoster, but destinations now diverge: roster is session-static so
    // it goes into the cached systemPrompt below; memories are per-turn
    // dynamic so they're routed into the uncached tail message instead (see
    // assembleSystemPrompt in ./prompt-assembly for the cache-stability
    // rationale).
    const roster = await sessionRoster;
    const rendered = assemblePrompt({ isSubagent, memories });

    // ── Auto-invoke: nudge the top-level agent to reach for skills ──
    // Pi core injects an <available_skills> block into the system prompt but
    // only softly ("use the read tool when it matches"). Non-Claude models
    // routinely ignore that hint, so restate it as a hard directive. Parent
    // only — subagents receive their curated skill set via pi-subagents.
    const skillsDirective = isSubagent ? "" : SKILLS_DIRECTIVE;

    // ── Goal mode: persistence rules for the whole active-goal turn ─────
    // Stands in the system prompt (not just the follow-up directive) so the
    // agent finishes more work per turn and stops less — fewer turns, fewer
    // evaluator calls, less chance of nearing the turn ceiling. Runs in
    // parent and subagent alike: isActive() is only ever true where a goal
    // was set (subagents don't drive the loop, but a directly-set goal there
    // still benefits from the persistence framing).
    const goalSnap = goalController.snapshot();
    const goalDirective = goalSnap?.status === "active"
      ? buildGoalSystemPrompt(goalSnap.condition)
      : "";

    // event.systemPrompt is Pi's base prompt (skills block, AGENTS.md, tool
    // snippets) — folding it in here is the fix: it was previously dropped
    // on the floor every parent turn. Static blocks (base prompt, trusted
    // instructions, skills directive, roster) stay on the cached systemPrompt
    // breakpoint; dynamic per-turn blocks (memories, goal) move to a separate
    // uncached tail message so they don't bust the prompt cache every turn.
    const assembled = assembleSystemPrompt({
      baseSystemPrompt: event.systemPrompt ?? "",
      isSubagent,
      trustedInstructions: isSubagent ? [] : TRUSTED_INSTRUCTIONS,
      skillsDirective,
      roster: isSubagent ? "" : formatRoster(roster),
      memoriesBlock: rendered.memoriesMessage,
      goalDirective,
    });

    return {
      ...(assembled.systemPrompt ? { systemPrompt: assembled.systemPrompt } : {}),
      ...(assembled.dynamicMessage
        ? { message: { customType: "harness-context", content: assembled.dynamicMessage, display: false } }
        : {}),
    };
  });
}
