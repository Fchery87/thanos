import { describe, it, expect } from "vitest";
import {
  shouldSandbox,
  buildBwrapArgv,
  SENSITIVE_AGENT_FILES,
  SENSITIVE_AGENT_FILE_PLACEHOLDERS,
} from "../../src/security/sandbox";

describe("shouldSandbox", () => {
  const on = { platform: "linux", bwrapAvailable: true } as const;

  it("engages for no-mistakes", () => {
    expect(
      shouldSandbox({ ...on, mode: "no-mistakes", autonomy: "attended", yolo: false }).sandbox,
    ).toBe(true);
  });

  it("engages for unattended", () => {
    expect(
      shouldSandbox({ ...on, mode: "local-only", autonomy: "unattended", yolo: false }).sandbox,
    ).toBe(true);
  });

  it("engages when yolo on", () => {
    expect(
      shouldSandbox({ ...on, mode: "direct-PR", autonomy: "attended", yolo: true }).sandbox,
    ).toBe(true);
  });

  it("skips ordinary attended local-only", () => {
    expect(
      shouldSandbox({ ...on, mode: "local-only", autonomy: "attended", yolo: false }).sandbox,
    ).toBe(false);
  });

  it("never sandboxes off-linux", () => {
    expect(
      shouldSandbox({
        platform: "darwin",
        bwrapAvailable: true,
        mode: "no-mistakes",
        autonomy: "unattended",
        yolo: true,
      }).sandbox,
    ).toBe(false);
  });

  it("no-mistakes + missing bwrap = DENY", () => {
    const result = shouldSandbox({
      platform: "linux",
      bwrapAvailable: false,
      mode: "no-mistakes",
      autonomy: "attended",
      yolo: false,
    });
    expect(result.action).toBe("deny");
    expect(result.sandbox).toBe(false);
    expect(result.reason).toMatch(/bwrap/i);
  });

  it("other modes + missing bwrap = warn-fallthrough", () => {
    const result = shouldSandbox({
      platform: "linux",
      bwrapAvailable: false,
      mode: "local-only",
      autonomy: "unattended",
      yolo: false,
    });
    expect(result.action).toBe("warn");
    expect(result.sandbox).toBe(false);
    expect(result.reason).toMatch(/bwrap/i);
  });

  it("ordinary attended local-only with no bwrap is a plain run, no warning needed", () => {
    const result = shouldSandbox({
      platform: "linux",
      bwrapAvailable: false,
      mode: "local-only",
      autonomy: "attended",
      yolo: false,
    });
    expect(result.action).toBe("run");
    expect(result.sandbox).toBe(false);
  });

  it("off-linux with bwrap unavailable is still just a plain run", () => {
    const result = shouldSandbox({
      platform: "darwin",
      bwrapAvailable: false,
      mode: "no-mistakes",
      autonomy: "unattended",
      yolo: true,
    });
    expect(result.action).toBe("run");
    expect(result.sandbox).toBe(false);
  });

  it("normal engaged sandbox reports action run", () => {
    const result = shouldSandbox({ ...on, mode: "no-mistakes", autonomy: "attended", yolo: false });
    expect(result.action).toBe("run");
    expect(result.sandbox).toBe(true);
  });
});

describe("buildBwrapArgv", () => {
  const argv = buildBwrapArgv({
    repo: "/r",
    tmp: "/t",
    home: "/h",
    inner: ["pi", "--foo"],
  });

  it("starts with the bwrap binary", () => {
    expect(argv[0]).toBe("bwrap");
  });

  it("uses --ro-bind / / as the base (NOT --dev-bind, which provides zero containment)", () => {
    const i = argv.indexOf("--ro-bind");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(argv[i + 1]).toBe("/");
    expect(argv[i + 2]).toBe("/");
    expect(argv).not.toContain("--dev-bind");
  });

  it("sets up a real /dev, /proc, and private tmpfs /tmp", () => {
    expect(argv.slice(argv.indexOf("--dev"), argv.indexOf("--dev") + 2)).toEqual(["--dev", "/dev"]);
    expect(argv.slice(argv.indexOf("--proc"), argv.indexOf("--proc") + 2)).toEqual(["--proc", "/proc"]);
    expect(argv.slice(argv.indexOf("--tmpfs"), argv.indexOf("--tmpfs") + 2)).toEqual(["--tmpfs", "/tmp"]);
  });

  it("rw-binds repo, scratch tmp, and the toolchain dirs the pi/bun/git chain needs", () => {
    const binds = bindPairs(argv, "--bind");
    expect(binds).toContainEqual(["/r", "/r"]);
    expect(binds).toContainEqual(["/t", "/t"]);
    expect(binds).toContainEqual(["/h/.pi/agent", "/h/.pi/agent"]);
    expect(binds).toContainEqual(["/h/.bun", "/h/.bun"]);
  });

  it("does NOT rw-bind ~/.cache (empirically verified via strace: nothing pi/bun/git touches lives there; bun's own cache is under ~/.bun)", () => {
    const binds = bindPairs(argv, "--bind");
    expect(binds).not.toContainEqual(["/h/.cache", "/h/.cache"]);
    expect(argv.join(" ")).not.toContain(".cache");
  });

  it("re-locks every sensitive agent file to read-only via --ro-bind-try, same source and dest", () => {
    const roBindTryPairs = bindPairs(argv, "--ro-bind-try");
    for (const name of SENSITIVE_AGENT_FILES) {
      const path = `/h/.pi/agent/${name}`;
      expect(roBindTryPairs).toContainEqual([path, path]);
    }
  });

  it("SECURITY-CRITICAL: re-locks projects.json read-only — the trust registry a sandboxed (least-trusted) process must never be able to rewrite to escalate its own future trust", () => {
    // This is the exact file the reproduced-live exploit targeted:
    // `sh -c 'echo PWNED > "$HOME/.pi/agent/projects.json"'` succeeded before
    // this --ro-bind-try was added. Regression guard for that specific bug.
    const roBindTryPairs = bindPairs(argv, "--ro-bind-try");
    expect(roBindTryPairs).toContainEqual([
      "/h/.pi/agent/projects.json",
      "/h/.pi/agent/projects.json",
    ]);
  });

  it("re-locks auth.json, models.local.secret.json, and trust.json read-only", () => {
    const roBindTryPairs = bindPairs(argv, "--ro-bind-try");
    expect(roBindTryPairs).toContainEqual(["/h/.pi/agent/auth.json", "/h/.pi/agent/auth.json"]);
    expect(roBindTryPairs).toContainEqual([
      "/h/.pi/agent/models.local.secret.json",
      "/h/.pi/agent/models.local.secret.json",
    ]);
    expect(roBindTryPairs).toContainEqual(["/h/.pi/agent/trust.json", "/h/.pi/agent/trust.json"]);
  });

  it("does NOT re-lock models-store.json or settings.json (genuinely written by a running session)", () => {
    const roBindTryPairs = bindPairs(argv, "--ro-bind-try");
    expect(roBindTryPairs).not.toContainEqual([
      "/h/.pi/agent/models-store.json",
      "/h/.pi/agent/models-store.json",
    ]);
    expect(roBindTryPairs).not.toContainEqual([
      "/h/.pi/agent/settings.json",
      "/h/.pi/agent/settings.json",
    ]);
  });

  it("orders every sensitive-file --ro-bind-try AFTER the parent rw --bind of .pi/agent (bwrap: later overlapping mount wins)", () => {
    const parentBindIndex = argv.indexOf("/h/.pi/agent");
    expect(parentBindIndex).toBeGreaterThanOrEqual(0);
    for (const name of SENSITIVE_AGENT_FILES) {
      const path = `/h/.pi/agent/${name}`;
      const roBindTryFlagIndex = argv.indexOf(path) - 1;
      expect(argv[roBindTryFlagIndex]).toBe("--ro-bind-try");
      expect(argv.indexOf(path)).toBeGreaterThan(parentBindIndex);
    }
  });

  it("chdirs into the repo", () => {
    const i = argv.indexOf("--chdir");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(argv[i + 1]).toBe("/r");
  });

  it("unshares everything except network", () => {
    expect(argv).toContain("--unshare-all");
    expect(argv).toContain("--share-net");
  });

  it("dies with its parent (prevents orphaned sandboxed process trees)", () => {
    // Load-bearing, empirically verified: bwrap forks an outer setup process
    // and an inner reaper for the new pid namespace. Without --die-with-parent,
    // killing the outer `bwrap` process leaves the inner reaper + sandboxed
    // command running as orphans. --die-with-parent makes bwrap SIGKILL the
    // sandboxed command when bwrap (or its parent) dies.
    expect(argv).toContain("--die-with-parent");
  });

  it("ends with a `--` separator then the inner command verbatim", () => {
    const i = argv.indexOf("--");
    expect(i).toBeGreaterThanOrEqual(0);
    expect(argv.slice(i + 1)).toEqual(["pi", "--foo"]);
  });

  it("places the -- separator strictly after all bwrap flags/binds", () => {
    const sepIndex = argv.indexOf("--");
    const roBindIndex = argv.indexOf("--ro-bind");
    const chdirIndex = argv.indexOf("--chdir");
    expect(sepIndex).toBeGreaterThan(roBindIndex);
    expect(sepIndex).toBeGreaterThan(chdirIndex);
  });
});

/** Walk argv pulling out (src, dest) pairs that immediately follow `flag`. */
function bindPairs(argv: string[], flag: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag) {
      pairs.push([argv[i + 1], argv[i + 2]]);
    }
  }
  return pairs;
}

describe("SENSITIVE_AGENT_FILE_PLACEHOLDERS", () => {
  // Second-round Critical fix: --ro-bind-try is a no-op on a missing source,
  // so every sensitive file needs a pre-creation placeholder — and each
  // placeholder must be BEHAVIORALLY IDENTICAL to "file missing" for its
  // real consumer, not just "some valid JSON". See the doc comment on
  // SENSITIVE_AGENT_FILE_PLACEHOLDERS in src/security/sandbox.ts for the
  // full per-file verification (pi's own auth-storage.js/trust-manager.js/
  // model-registry.js source, and src/governance/delivery.ts).

  it("has exactly one placeholder per sensitive file, no more, no less", () => {
    const placeholderKeys = Object.keys(SENSITIVE_AGENT_FILE_PLACEHOLDERS).sort();
    const sensitiveKeys = [...SENSITIVE_AGENT_FILES].sort();
    expect(placeholderKeys).toEqual(sensitiveKeys);
  });

  it("every placeholder is valid, parseable JSON (a 0-byte file would crash pi's own trust-manager)", () => {
    for (const name of SENSITIVE_AGENT_FILES) {
      const content = SENSITIVE_AGENT_FILE_PLACEHOLDERS[name];
      expect(() => JSON.parse(content)).not.toThrow();
    }
  });

  it("auth.json placeholder matches pi's OWN native empty-auth.json convention exactly", () => {
    // node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js's
    // FileAuthStorageBackend.ensureFileExists() writes exactly "{}" (mode
    // 0o600) the first time any auth operation touches a missing auth.json.
    expect(JSON.parse(SENSITIVE_AGENT_FILE_PLACEHOLDERS["auth.json"])).toEqual({});
  });

  it("trust.json placeholder parses to {} — identical to pi's readTrustFile missing-file branch", () => {
    // pi's readTrustFile (core/trust-manager.js) returns {} directly for a
    // missing file, but would THROW on a genuinely empty (0-byte) file since
    // JSON.parse("") fails and nothing at the call site catches it. "{}" is
    // valid JSON parsing to an empty object — same net result, no throw.
    expect(JSON.parse(SENSITIVE_AGENT_FILE_PLACEHOLDERS["trust.json"])).toEqual({});
  });

  it("projects.json placeholder is byte-for-byte the same fallback resolveDelivery already uses for a missing registry", () => {
    const parsed = JSON.parse(SENSITIVE_AGENT_FILE_PLACEHOLDERS["projects.json"]);
    expect(parsed).toEqual({
      version: 1,
      default: { mode: "local-only", autonomy: "attended" },
      projects: [],
    });
  });

  it("models.json placeholder includes a `providers` key (required, non-optional in pi's schema) so it validates cleanly rather than surfacing an 'Invalid models.json schema' warning", () => {
    const parsed = JSON.parse(SENSITIVE_AGENT_FILE_PLACEHOLDERS["models.json"]);
    expect(parsed).toEqual({ providers: {} });
  });

  it("models.local.secret.json placeholder mirrors the same {providers:{}} convention (most conservative choice; no direct consumer of this filename was found in this repo)", () => {
    const parsed = JSON.parse(SENSITIVE_AGENT_FILE_PLACEHOLDERS["models.local.secret.json"]);
    expect(parsed).toEqual({ providers: {} });
  });
});
