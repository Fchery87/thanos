import { describe, expect, it } from "vitest";
import { makeContextEnvelope } from "../../src/context/envelope";

describe("context envelope", () => {
  it("preserves origin, authority, scope, source, trust, and bounds", () => {
    const envelope = makeContextEnvelope({
      id: "memory-1",
      origin: "memory",
      authority: "preference",
      scope: "project",
      source: ".harness/memory.json",
      trusted: false,
      content: "Prefer Vitest",
      maxBytes: 128,
    });

    expect(envelope).toMatchObject({
      origin: "memory",
      authority: "preference",
      scope: "project",
      source: ".harness/memory.json",
      trusted: false,
      content: "Prefer Vitest",
      maxBytes: 128,
    });
  });

  it("preserves optional freshness metadata", () => {
    const envelope = makeContextEnvelope({
      id: "evidence-1",
      origin: "tool",
      authority: "evidence",
      scope: "turn",
      source: "diff-evidence",
      trusted: false,
      capturedAt: "2026-08-02T00:00:00.000Z",
      staleAfter: "2026-08-02T01:00:00.000Z",
      content: "diff summary",
      maxBytes: 128,
    });

    expect(envelope.capturedAt).toBe("2026-08-02T00:00:00.000Z");
    expect(envelope.staleAfter).toBe("2026-08-02T01:00:00.000Z");
  });
});
