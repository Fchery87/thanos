import { describe, expect, it } from "vitest";
import { parseWavesCommand } from "../../src/workflows/command";

describe("parseWavesCommand", () => {
  it("routes status, lifecycle controls, goal attachment, and arbitrary goals", () => {
    expect(parseWavesCommand("")).toEqual({ kind: "status" });
    expect(parseWavesCommand(" STATUS ")).toEqual({ kind: "status" });
    expect(parseWavesCommand("goal")).toEqual({ kind: "attach_goal" });
    expect(parseWavesCommand("pause")).toEqual({ kind: "pause" });
    expect(parseWavesCommand("resume")).toEqual({ kind: "resume" });
    expect(parseWavesCommand("cancel")).toEqual({ kind: "cancel" });
    expect(parseWavesCommand("handoff")).toEqual({ kind: "handoff" });
    expect(parseWavesCommand(" stop the flaky test ")).toEqual({
      kind: "start",
      goal: "stop the flaky test",
    });
  });

  it("parses contract-revising resume ceilings as positive total limits", () => {
    expect(parseWavesCommand("resume --max-integration-turns 18")).toEqual({
      kind: "resume",
      maxIntegrationTurns: 18,
    });
    expect(parseWavesCommand("resume --max-jury-rounds 5")).toEqual({
      kind: "resume",
      maxJuryRounds: 5,
    });
    expect(parseWavesCommand(
      "resume --max-integration-turns 18 --max-jury-rounds 5",
    )).toEqual({
      kind: "resume",
      maxIntegrationTurns: 18,
      maxJuryRounds: 5,
    });
  });

  it("rejects malformed or repeated resume flags instead of treating them as goals", () => {
    for (const input of [
      "resume --max-integration-turns",
      "resume --max-integration-turns 0",
      "resume --max-integration-turns 2.5",
      "resume --max-jury-rounds nope",
      "resume --unknown 3",
      "resume --max-jury-rounds 4 --max-jury-rounds 5",
    ]) {
      expect(parseWavesCommand(input)).toMatchObject({ kind: "invalid" });
    }
  });
});
