import { describe, expect, it } from "vitest";
import { classifyEgress, evaluateEgress } from "../../src/governance/egress";

describe("classifyEgress", () => {
  it("classifies non-bash tools as local", () => {
    expect(classifyEgress("read", { file_path: "src/index.ts" })).toBe("local");
    expect(classifyEgress("write", { file_path: "src/index.ts" })).toBe("local");
    expect(classifyEgress("edit", { file_path: "src/index.ts" })).toBe("local");
  });

  it("classifies read-only bash commands as local", () => {
    expect(classifyEgress("bash", { command: "ls" })).toBe("local");
    expect(classifyEgress("bash", { command: "cat README.md" })).toBe("local");
    expect(classifyEgress("bash", { command: "git status" })).toBe("local");
    expect(classifyEgress("bash", { command: "git log --oneline" })).toBe("local");
    expect(classifyEgress("bash", { command: "echo hello" })).toBe("local");
    expect(classifyEgress("bash", { command: "npm test" })).toBe("local");
  });

  it("classifies curl as network", () => {
    expect(classifyEgress("bash", { command: "curl https://example.com" })).toBe("network");
    expect(classifyEgress("bash", { command: "curl -X POST https://api.example.com" })).toBe("network");
  });

  it("classifies wget as network", () => {
    expect(classifyEgress("bash", { command: "wget https://example.com/file" })).toBe("network");
  });

  it("classifies scp as network", () => {
    expect(classifyEgress("bash", { command: "scp file.txt user@host:/tmp/" })).toBe("network");
  });

  it("classifies rsync as network", () => {
    expect(classifyEgress("bash", { command: "rsync -avz src/ user@host:/dest/" })).toBe("network");
  });

  it("classifies ssh as network", () => {
    expect(classifyEgress("bash", { command: "ssh user@host" })).toBe("network");
    expect(classifyEgress("bash", { command: "sftp user@host" })).toBe("network");
  });

  it("classifies curl with auth header as credentialed", () => {
    expect(classifyEgress("bash", { command: 'curl -H "Authorization: Bearer token" https://api.example.com' })).toBe("credentialed");
    expect(classifyEgress("bash", { command: "curl --header 'Authorization: Bearer xyz' https://api.example.com" })).toBe("credentialed");
  });

  it("classifies git push/pull/fetch/clone as repo-remote", () => {
    expect(classifyEgress("bash", { command: "git push origin main" })).toBe("repo-remote");
    expect(classifyEgress("bash", { command: "git pull" })).toBe("repo-remote");
    expect(classifyEgress("bash", { command: "git fetch origin" })).toBe("repo-remote");
    expect(classifyEgress("bash", { command: "git clone https://github.com/user/repo" })).toBe("repo-remote");
  });

  it("classifies npm publish as network", () => {
    expect(classifyEgress("bash", { command: "npm publish" })).toBe("network");
    expect(classifyEgress("bash", { command: "cargo publish" })).toBe("network");
  });

  it("classifies npm install as local", () => {
    expect(classifyEgress("bash", { command: "npm install express" })).toBe("local");
    expect(classifyEgress("bash", { command: "pip install requests" })).toBe("local");
  });

  it("classifies empty command as unknown", () => {
    expect(classifyEgress("bash", { command: "" })).toBe("unknown");
    expect(classifyEgress("bash", {})).toBe("unknown");
  });

  it("classifies git read subcommands as local", () => {
    expect(classifyEgress("bash", { command: "git show HEAD:src/index.ts" })).toBe("local");
    expect(classifyEgress("bash", { command: "git diff" })).toBe("local");
    expect(classifyEgress("bash", { command: "git rev-parse HEAD" })).toBe("local");
  });

  it("classifies nc/ncat as network", () => {
    expect(classifyEgress("bash", { command: "nc -l 8080" })).toBe("network");
    expect(classifyEgress("bash", { command: "ncat example.com 80" })).toBe("network");
  });
});

describe("evaluateEgress", () => {
  it("allows local egress in all modes", () => {
    expect(evaluateEgress("local", "local-only", false).allowed).toBe(true);
    expect(evaluateEgress("local", "direct-PR", false).allowed).toBe(true);
    expect(evaluateEgress("local", "no-mistakes", false).allowed).toBe(true);
  });

  it("blocks network egress in local-only mode", () => {
    const r = evaluateEgress("network", "local-only", false);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("local-only");
  });

  it("blocks repo-remote egress in local-only mode", () => {
    const r = evaluateEgress("repo-remote", "local-only", false);
    expect(r.allowed).toBe(false);
  });

  it("blocks credentialed egress in local-only mode", () => {
    const r = evaluateEgress("credentialed", "local-only", false);
    expect(r.allowed).toBe(false);
  });

  it("blocks unknown egress in local-only mode", () => {
    const r = evaluateEgress("unknown", "local-only", false);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain("unrecognized");
  });

  it("allows network egress in non-local-only modes", () => {
    expect(evaluateEgress("network", "direct-PR", false).allowed).toBe(true);
    expect(evaluateEgress("network", "no-mistakes", false).allowed).toBe(true);
    expect(evaluateEgress("network", undefined, false).allowed).toBe(true);
  });

  it("allows egress when yolo is enabled (regardless of mode)", () => {
    expect(evaluateEgress("network", "local-only", true).allowed).toBe(true);
    expect(evaluateEgress("repo-remote", "local-only", true).allowed).toBe(true);
    expect(evaluateEgress("credentialed", "local-only", true).allowed).toBe(true);
  });
});
