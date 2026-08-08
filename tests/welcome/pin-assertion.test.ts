import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkPinDrift,
  findUnpinnedDelegationPackage,
  formatUnpinnedPinWarning,
} from "../../src/welcome/pin-assertion";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function settingsFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "thanos-pin-assertion-"));
  dirs.push(dir);
  const path = join(dir, "settings.json");
  await writeFile(path, content, "utf-8");
  return path;
}

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

  it("keeps scanning past an exact match to catch a later unpinned duplicate entry", () => {
    expect(findUnpinnedDelegationPackage(["npm:pi-subagents@0.42.1", "npm:pi-subagents"])).toBe("npm:pi-subagents");
  });

  it("names the file to edit in the warning", () => {
    const warning = formatUnpinnedPinWarning("npm:pi-subagents");
    expect(warning).toContain("agent/settings.json");
    expect(warning).toContain("npm:pi-subagents@");
  });

  it("interpolates a custom settings path into the warning", () => {
    const warning = formatUnpinnedPinWarning("npm:pi-subagents", "/tmp/custom/settings.json");
    expect(warning).toContain("/tmp/custom/settings.json");
  });

  describe("checkPinDrift (real file I/O)", () => {
    it("returns undefined when the settings file does not exist", async () => {
      expect(await checkPinDrift(join(tmpdir(), "definitely-not-a-settings-file.json"))).toBeUndefined();
    });

    it("returns undefined when packages is absent", async () => {
      const path = await settingsFile(JSON.stringify({}));
      expect(await checkPinDrift(path)).toBeUndefined();
    });

    it("returns undefined when packages is present but not an array", async () => {
      const path = await settingsFile(JSON.stringify({ packages: "not-an-array" }));
      expect(await checkPinDrift(path)).toBeUndefined();
    });

    it("returns undefined when the pin is exact", async () => {
      const path = await settingsFile(JSON.stringify({ packages: ["npm:pi-subagents@0.41.0"] }));
      expect(await checkPinDrift(path)).toBeUndefined();
    });

    it("returns the offending spec when the pin has drifted", async () => {
      const path = await settingsFile(JSON.stringify({ packages: ["npm:pi-subagents"] }));
      expect(await checkPinDrift(path)).toBe("npm:pi-subagents");
    });

    it("propagates malformed JSON rather than silencing it", async () => {
      const path = await settingsFile("{ not valid json");
      await expect(checkPinDrift(path)).rejects.toThrow();
    });
  });
});
