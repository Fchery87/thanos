import { describe, expect, it } from "vitest";
import {
  HARNESS_LEDGER_DEFAULT_PATH,
  serializeHarnessEvent,
  type HarnessEvent,
} from "../../src/observability/harness-ledger";

describe("serializeHarnessEvent", () => {
  it("records gate failures with task, model, evidence, and outcome fields", () => {
    const line = serializeHarnessEvent({
      type: "gate_failure",
      taskId: "session-1",
      model: "theclawbay/gpt-5.5",
      summary: "Tests missing",
      evidence: ["Spec criterion: Tests written"],
      outcome: "needs_work",
      createdAt: "2026-06-30T00:00:00.000Z",
    });

    expect(JSON.parse(line)).toMatchObject({
      type: "gate_failure",
      taskId: "session-1",
      model: "theclawbay/gpt-5.5",
      outcome: "needs_work",
    });
    expect(line.endsWith("\n")).toBe(true);
  });

  it("supports every planned high-signal event type", () => {
    const types: HarnessEvent["type"][] = [
      "gate_failure",
      "gate_pass",
      "review_disagreement",
      "wave_handoff_rejected",
      "delivery_gate_failed",
      "manual_override",
      "harness_change",
    ];

    for (const type of types) {
      expect(() => serializeHarnessEvent({
        type,
        taskId: "session-1",
        summary: type,
        outcome: "observed",
        createdAt: "2026-06-30T00:00:00.000Z",
      })).not.toThrow();
    }
  });

  it("accepts goal lifecycle event types", () => {
    for (const type of ["goal_set", "goal_achieved", "goal_paused"] as const) {
      const line = serializeHarnessEvent({
        type, taskId: "s1", summary: "x", outcome: "ok",
        createdAt: "2026-07-02T00:00:00.000Z",
      });
      expect(JSON.parse(line).type).toBe(type);
    }
  });

  it("exposes the default JSONL path", () => {
    expect(HARNESS_LEDGER_DEFAULT_PATH).toBe(".harness/evolution/events.jsonl");
  });
});
