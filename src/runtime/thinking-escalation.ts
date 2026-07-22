// Escape hatch for the medium-thinking default: high-assurance work (`/goal` and
// explicit `--spec`) runs at the current model's maximum thinking level, and the
// user's baseline is restored the moment neither is active. This keeps ordinary
// prompts fast (medium) while never dulling reasoning on the paths that asked for
// it — the "reach max thinking on demand" requirement of the fast-lane plan.
//
// Pure and state-in/state-out so it is trivially testable; the caller owns the
// live pi calls (getThinkingLevel / setThinkingLevel) and holds the state across
// turns.

export interface ThinkingEscalationState {
  /** The user's level captured when we first escalated; null when not escalated. */
  saved: string | null;
  /** The level we escalated *to*, so we can detect a manual override before restoring. */
  escalatedTo: string | null;
}

export const NO_ESCALATION: ThinkingEscalationState = { saved: null, escalatedTo: null };

export interface ThinkingEscalationInput {
  /** True when a goal is active OR the explicit `--spec` flag is set (parent only). */
  active: boolean;
  /** The current model's supported levels, ordered low→high; empty if it can't reason. */
  supportedLevels: string[];
  /** The live thinking level, or undefined when reasoning is off. */
  current: string | undefined;
  state: ThinkingEscalationState;
}

export interface ThinkingEscalationResult {
  /** When present, the caller applies it via pi.setThinkingLevel. */
  setLevel?: string;
  state: ThinkingEscalationState;
}

export function computeThinkingEscalation(input: ThinkingEscalationInput): ThinkingEscalationResult {
  const { active, supportedLevels, current, state } = input;
  const top = supportedLevels[supportedLevels.length - 1];

  // Non-reasoning model (no levels): can neither escalate nor restore — drop state.
  if (!top) return { state: NO_ESCALATION };

  if (active) {
    // Already escalated — hold at max for the duration.
    if (state.saved !== null) return { state };
    const baseline = current ?? top;
    // Already at the ceiling: record state without a redundant set.
    if (current === top) return { state: { saved: baseline, escalatedTo: top } };
    return { setLevel: top, state: { saved: baseline, escalatedTo: top } };
  }

  // Not active: restore the baseline, but only if we still own the level. If the
  // user changed thinking manually mid-goal, respect that and just drop our state.
  if (state.saved !== null) {
    if (current === state.escalatedTo) {
      return { setLevel: state.saved, state: NO_ESCALATION };
    }
    return { state: NO_ESCALATION };
  }
  return { state };
}
