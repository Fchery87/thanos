import { describe, expect, it } from "vitest";
import { makeContextEnvelope } from "../../src/context/envelope";

describe("context envelope", () => {
  it("preserves origin, authority, trust, and bounds", () => {
    const envelope = makeContextEnvelope({
      id: "memory-1",
      origin: "memory",
      authority: "preference",
      trusted: false,
      content: "Prefer Vitest",
      maxBytes: 128,
    });

    expect(envelope).toMatchObject({
      origin: "memory",
      authority: "preference",
      trusted: false,
      content: "Prefer Vitest",
      maxBytes: 128,
    });
  });
});
