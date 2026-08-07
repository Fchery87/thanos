import { describe, expect, it } from "vitest";
import { findUnpinnedDelegationPackage, formatUnpinnedPinWarning } from "../../src/welcome/pin-assertion";

describe("pi-subagents pin assertion", () => {
  it("accepts an explicitly pinned spec", () => {
    expect(findUnpinnedDelegationPackage(["npm:pi-subagents@0.41.0", "npm:pi-web-access"])).toBeUndefined();
  });

  it("flags a spec with no version", () => {
    expect(findUnpinnedDelegationPackage(["npm:pi-subagents"])).toBe("npm:pi-subagents");
  });

  it("flags a range rather than an exact version", () => {
    expect(findUnpinnedDelegationPackage(["npm:pi-subagents@^0.41.0"])).toBe("npm:pi-subagents@^0.41.0");
  });

  it("ignores unrelated packages entirely", () => {
    expect(findUnpinnedDelegationPackage(["npm:pi-web-access", "npm:@npm-ken/pi-bar"])).toBeUndefined();
  });

  it("names the file to edit in the warning", () => {
    const warning = formatUnpinnedPinWarning("npm:pi-subagents");
    expect(warning).toContain("agent/settings.json");
    expect(warning).toContain("npm:pi-subagents@");
  });
});
