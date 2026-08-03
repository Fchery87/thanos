import { buildPromptSections, renderCompletionCriteria } from "../prompts/style";
import { makeContextEnvelope } from "../context/envelope";
import { renderContextEnvelopeOrOmit } from "../context/render";

/**
 * What each evidence kind means to the verifier, stated in the extractor's own
 * terms. `manual` is named rather than hidden: the criterion that demanded
 * evidence the runtime agent cannot emit is exactly what made the gate loop
 * (see the 2026-07-22 plan's W1), so the trap is called out explicitly instead
 * of being left for the model to rediscover.
 */
const EVIDENCE_VOCABULARY = [
  "- diff    — a file changed on disk. Checked against git, not against what a tool was asked to do.",
  "- test    — a test runner exited zero. Package scripts resolve, so `bun run test` counts as a test run.",
  "- command — any other command exited zero (build, lint, typecheck). Trivial commands (echo, printf, grep) never count.",
  "- manual  — asserted by the user or an evaluator. THE WORKING AGENT CANNOT PRODUCE THIS, so a criterion",
  "            requiring it can never pass. Never use it for work the agent is being asked to do.",
].join("\n");

/**
 * Ask a model to turn a request into a machine-checkable TaskContract.
 *
 * The request is wrapped as untrusted context: this output drives the
 * verification gate, so text inside the request must read as data rather than as
 * instructions to the extractor. `contract-schema.ts` is the enforcing boundary —
 * it rejects anything malformed and clamps `verificationMode`, so a request
 * cannot talk the extractor into a contract that never gates.
 */
export function buildContractExtractionPrompt(request: string): string {
  return buildPromptSections([
    { heading: "Question", body: "What must be observably true for this request to be done?" },
    {
      heading: "Mental model",
      body: [
        "You are writing a machine-checked contract, not a plan. Each criterion is proved only by tool",
        "telemetry from the turn that follows. A criterion nothing can prove blocks the agent until its",
        "retry budget is spent; a criterion anything proves is worthless. Write the smallest set that",
        "would convince a skeptic the work actually happened.",
      ].join("\n"),
    },
    {
      heading: "Request",
      // A malformed request (control chars, over budget) must not crash
      // extraction — fall back to a plain quoted excerpt rather than throw.
      body: renderContextEnvelopeOrOmit(makeContextEnvelope({
        id: "extractor-request",
        origin: "user",
        authority: "request",
        scope: "turn",
        source: "extractor-request",
        trusted: false,
        content: request,
        maxBytes: 20_000,
      })) ?? `content:${JSON.stringify(request.slice(0, 20_000))}`,
    },
    { heading: "Evidence kinds", body: EVIDENCE_VOCABULARY },
    {
      heading: "Action",
      body: [
        "- Emit 1-3 criteria. More is worse: each is another way for the turn to be blocked.",
        "- Anything that changes code needs `diff`. Add `evidenceAnyOf: [[\"test\",\"command\"]]` when it must",
        "  also be verified but you cannot know whether a test or a build will be what proves it.",
        "- Use `verificationMode: \"advisory\"` when correctness is a judgement call — audits, investigations,",
        "  open-ended analysis. Advisory criteria are reported, never enforced.",
        "- `targets` are repo-relative paths that must change, e.g. [\"src/billing\"]. Omit rather than guess:",
        "  a wrong target silently voids otherwise-valid evidence.",
        "- `expectedExecutables` use normalized forms — \"vitest\", \"bun test\", \"go test\" — or omit entirely.",
        "- `mustNot` only for a prohibition stated in the request itself.",
      ].join("\n"),
    },
    {
      heading: "Check",
      body: renderCompletionCriteria([
        "return ONLY a JSON object, no prose and no code fence: {\"objective\": string, \"criteria\": [...]}",
        "each criterion has id, kind, statement, targets, evidence, expectedExecutables, expectedArgs, mustNot, source",
        "kind is one of rename|fix|build|audit|secure|investigate|manual; source is always \"semantic_extraction\"",
        // The escape hatch that used to sit here — "return {objective:'',criteria:[]}
        // when the request is too vague" — is gone. settleContract() discards an
        // empty-objective contract, so the instruction was an invitation to
        // produce nothing, offered on every turn. A vague request still has an
        // observable outcome; write the loosest criterion that would prove it
        // rather than declining. The deterministic fallback is the floor if this
        // call fails, not a preferred answer.
      ]),
    },
  ]);
}

/**
 * Pull the contract object out of a model response. Tolerates a code fence or
 * surrounding prose, because "return ONLY JSON" is a request, not a guarantee.
 * Anything unparseable yields undefined, and the schema rejects the rest.
 */
export function parseContractResponse(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;

  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}
