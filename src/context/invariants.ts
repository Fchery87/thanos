import type { ContextEvent } from "@earendil-works/pi-coding-agent";
import type { GoalController } from "../goal/controller";
import { buildGoalSystemPrompt } from "../goal/prompts";
import { formatSpecCriteria, type SpecEngine } from "../spec/engine";
import { formatWorkflowStage, type WorkflowRuntime } from "../workflows/state";
import { assembleSystemPrompt } from "../runtime/prompt-assembly";
import { makeContextEnvelope } from "./envelope";
import { renderContextEnvelopeOrOmit } from "./render";

// Derived from the public ContextEvent type rather than importing AgentMessage
// from @earendil-works/pi-agent-core directly — that package is only a
// transitive dependency (of @earendil-works/pi-coding-agent), not one Thanos
// declares itself.
type AgentMessageLike = ContextEvent["messages"][number];

/**
 * Stable identity for the restored block, embedded as the envelope's `id:`
 * line (see render.ts's fixed field order) — this is what `reconcileInvariantTail`
 * matches on to find and strip a stale copy, per the plan's "identify by
 * envelope id, not an ad-hoc HTML comment" constraint.
 */
export const INVARIANT_TAIL_ID = "harness-invariant-tail";

/**
 * Reuses before_agent_start's customType — both are hidden harness-authored
 * context, and sharing it is what lets `isAlreadyConveyed` recognize
 * before_agent_start's own turn-start message as already covering the same
 * ground, instead of injecting a redundant second copy beside it.
 */
export const INVARIANT_TAIL_CUSTOM_TYPE = "harness-context";

export interface InvariantTailDeps {
  goalController: GoalController;
  spec: SpecEngine;
  workflowRuntime: WorkflowRuntime;
}

/**
 * Governance-relevant subset of before-agent-start.ts's dynamic tail: goal +
 * spec + workflow, deliberately excluding memories (a per-turn preference,
 * not an invariant governance enforces — see envelope.ts's `trusted` note).
 * Built by calling assembleSystemPrompt itself (static-block args stubbed
 * empty; only `.dynamicMessage` is read) rather than re-joining the three
 * pieces by hand — a second construction path is exactly how the two would
 * drift apart.
 */
export function buildInvariantContent(deps: InvariantTailDeps): string | undefined {
  const goalSnap = deps.goalController.snapshot();
  const goalDirective = goalSnap?.status === "active" ? buildGoalSystemPrompt(goalSnap.condition) : "";
  return assembleSystemPrompt({
    baseSystemPrompt: "",
    isSubagent: true,
    trustedInstructions: [],
    skillsDirective: "",
    roster: "",
    goalDirective,
    specCriteria: formatSpecCriteria(deps.spec.activeSpec),
    workflowStage: formatWorkflowStage(deps.workflowRuntime.current),
  }).dynamicMessage;
}

function isCustomTextMessage(
  message: AgentMessageLike,
): message is AgentMessageLike & { role: "custom"; content: string } {
  return message.role === "custom" && typeof message.content === "string";
}

function isInvariantTailMessage(
  message: AgentMessageLike,
): message is AgentMessageLike & { role: "custom"; content: string } {
  return isCustomTextMessage(message) && message.content.startsWith(`id:${INVARIANT_TAIL_ID}\n`);
}

/**
 * True when the current, up-to-date text is already conveyed by some
 * existing harness-authored message, so no (re)injection is needed:
 *
 *  - `content` (the raw, pre-envelope goal/spec/workflow text) appears
 *    verbatim inside before_agent_start's own turn-start `harness-context`
 *    message, which bundles the same text alongside memories and is never
 *    JSON-escaped. Without this check, the very first `context` hook call of
 *    an ordinary turn would inject a second, redundant copy right next to
 *    the one before_agent_start just sent — not just once, but for every
 *    remaining LLM call in that turn, since neither message would ever
 *    again look "missing."
 *  - OR `rendered` (the JSON-escaped envelope form) exactly matches a prior
 *    invariant-tail copy this function itself appended — the idempotence
 *    case. `content` alone can't detect this: escaping a multi-line string
 *    means it is never a raw substring of its own escaped form.
 */
function isAlreadyConveyed(messages: readonly AgentMessageLike[], content: string, rendered: string): boolean {
  return messages.some((message) => {
    if (!isCustomTextMessage(message) || message.customType !== INVARIANT_TAIL_CUSTOM_TYPE) return false;
    const isOwnCopy = message.content.startsWith(`id:${INVARIANT_TAIL_ID}\n`);
    return isOwnCopy ? message.content === rendered : message.content.includes(content);
  });
}

/**
 * Reconciles the invariant tail against the live `messages` array for the
 * `context` hook, which fires before every LLM call — including mid-turn,
 * after a compaction that `before_agent_start` (once per user turn) never
 * sees. Returns undefined whenever nothing needs to change, so an ordinary
 * turn with no active goal/spec/workflow — and a turn where the text is
 * already present, whether via a prior invariant-tail copy or via
 * before_agent_start's own turn-start message — pays nothing.
 */
export function reconcileInvariantTail(
  messages: readonly AgentMessageLike[],
  deps: InvariantTailDeps,
): AgentMessageLike[] | undefined {
  const content = buildInvariantContent(deps);
  if (!content) return undefined;

  const rendered = renderContextEnvelopeOrOmit(makeContextEnvelope({
    id: INVARIANT_TAIL_ID,
    origin: "harness",
    authority: "instruction",
    scope: "session",
    source: "context-invariants",
    trusted: true,
    content,
    maxBytes: 16_000,
  }));
  if (!rendered) return undefined;
  if (isAlreadyConveyed(messages, content, rendered)) return undefined;

  const kept = messages.filter((message) => !isInvariantTailMessage(message));
  const restored: AgentMessageLike = {
    role: "custom",
    customType: INVARIANT_TAIL_CUSTOM_TYPE,
    content: rendered,
    display: false,
    timestamp: Date.now(),
  };
  return [...kept, restored];
}
