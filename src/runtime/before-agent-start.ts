import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalController } from "../goal/controller";
import type { SpecEngine } from "../spec/engine";
import type { LensLite } from "../lens/lite";
import type { MemoryRecord } from "../memory/types";
import type { PermissionManager } from "../permissions/manager";
import { computeThinkingEscalation, NO_ESCALATION, type ThinkingEscalationState } from "./thinking-escalation";
import { getSupportedLevels, setThinkingStatus, type ThinkingLevel } from "./thinking-levels";
import { buildGoalSystemPrompt } from "../goal/prompts";
import { loadRoster } from "../agents/roster";
import { assemblePrompt } from "../context/broker";
import { consumeContinuation } from "./continuation-auth";
import { projectMemory } from "./commands/memory";

export interface BeforeAgentStartDeps {
  sessionId: string;
  isSubagent: boolean;
  permissions: PermissionManager;
  spec: SpecEngine;
  lens: LensLite;
  goalController: GoalController;
}

/**
 * before_agent_start: spec classification + session reset on each prompt,
 * the thinking-level escape hatch for /goal + --spec, hand-curated memory
 * injection, the specialist-roster directive, the skills-usage nudge, and
 * the active-goal persistence directive — assembled into one system prompt.
 */
export function registerBeforeAgentStart(pi: ExtensionAPI, deps: BeforeAgentStartDeps): void {
  const { sessionId, isSubagent, permissions, spec, lens, goalController } = deps;

  // Thinking escape hatch: /goal and --spec run at the model's max, restored when
  // neither is active. State persists across turns (parent session only) — this
  // handler is the only place that reads or writes it, so it lives here rather
  // than in the registerHarness() closure.
  let thinkingEscalation: ThinkingEscalationState = NO_ESCALATION;

  pi.on("before_agent_start", async (event, ctx) => {
    ctx.ui.setHeader(undefined);
    permissions.clearSessionRules();  // clear deny rules from any prior rejection
    const isHarnessContinuation =
      consumeContinuation(sessionId, "spec", event.prompt) ||
      consumeContinuation(sessionId, "goal", event.prompt);
    if (!isHarnessContinuation) {
      spec.startTurn(event.prompt, pi.getFlag("spec") === true);
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
    const roster = isSubagent ? [] : await loadRoster();
    const promptAssembly = assemblePrompt({
      isSubagent,
      memories,
      roster,
      goalCondition: goalController.snapshot()?.status === "active" ? goalController.snapshot()?.condition : undefined,
      trustedInstructions: isSubagent ? [] : [
        "Specialist subagents are available via the `subagent` tool.",
        "Do non-trivial work inline yourself by default — you are a capable generalist and inline work has no cold-start cost. Delegate to a specialist ONLY when the work is genuinely parallel (independent slices worth running at once), needs a capability you lack, or the user explicitly asked for deep review or /waves. A specialist run cold-starts a fresh child (seconds to load, often minutes of wall-clock), so reflexive delegation of ordinary work makes the session slower, not smarter.",
        "When you do delegate independent or pipelined tasks, use the parallel/chain modes.",
        "Read-only specialists cannot edit or run commands by design.",
        "Do NOT pass timeoutMs/maxRuntimeMs when delegating — every agent has its own maxExecutionTimeMs budget, and short caller timeouts kill healthy runs mid-flight, wasting all their work. If you must bound a run, use at least 600000 (10 minutes).",
      ],
    });

    // ── Auto-invoke: nudge the top-level agent to reach for skills ──
    // Pi core injects an <available_skills> block into the system prompt but
    // only softly ("use the read tool when it matches"). Non-Claude models
    // routinely ignore that hint, so restate it as a hard directive. Parent
    // only — subagents receive their curated skill set via pi-subagents.
    const skillsDirective = isSubagent ? "" :
      "Specialized skills are listed in the <available_skills> block of this " +
      "system prompt. Before doing non-trivial work, scan that block: if any " +
      "skill's description matches the task, `read` its SKILL.md file FIRST and " +
      "follow its instructions — do not improvise work a skill already covers. " +
      "A skill gives you a procedure to run inline; by default run it inline " +
      "yourself. Delegating skill-guided work to a subagent is only worth the " +
      "cold-start when the work is independent/parallel or genuinely needs fresh context.";

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

    const systemPrompt = [
      promptAssembly.trustedInstructions,
      skillsDirective,
      goalDirective,
      promptAssembly.contextMessage ?? "",
    ]
      .filter(Boolean)
      .join("\n\n");

    return systemPrompt ? { systemPrompt } : undefined;
  });
}
