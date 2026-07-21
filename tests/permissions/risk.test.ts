import { describe, expect, it } from "vitest";
import { classifyRisk, isRecognizedTool } from "../../src/permissions/risk";

describe("classifyRisk — non-bash tools (unchanged contract)", () => {
  it("keeps low-risk read tools low", () => {
    expect(classifyRisk("read", {})).toBe("low");
    expect(classifyRisk("ls", {})).toBe("low");
    expect(classifyRisk("find", {})).toBe("low");
    expect(classifyRisk("grep", {})).toBe("low");
  });

  it("keeps write/edit high", () => {
    expect(classifyRisk("write", {})).toBe("high");
    expect(classifyRisk("edit", {})).toBe("high");
  });

  it("keeps known harness interaction/delegation tools medium", () => {
    expect(classifyRisk("task", {})).toBe("medium");
    expect(classifyRisk("ask", {})).toBe("medium");
    expect(classifyRisk("todo", {})).toBe("medium");
    expect(classifyRisk("report_finding", {})).toBe("medium");
    expect(classifyRisk("goal_complete", {})).toBe("medium");
    expect(classifyRisk("subagent", {})).toBe("medium");
  });
});

describe("classifyRisk — unrecognized tools (e.g. MCP servers) are high risk", () => {
  it("tiers a tool name the harness has never registered as high", () => {
    expect(classifyRisk("mystery", {})).toBe("high");
    expect(classifyRisk("mcp__some-server__deploy", {})).toBe("high");
  });
});

describe("isRecognizedTool", () => {
  it("is true for every built-in and harness-registered tool", () => {
    for (const name of ["read", "ls", "find", "grep", "write", "edit", "bash", "task", "ask", "todo", "report_finding", "goal_complete", "subagent"]) {
      expect(isRecognizedTool(name)).toBe(true);
    }
  });

  it("is false for an unrecognized tool name", () => {
    expect(isRecognizedTool("mystery")).toBe(false);
    expect(isRecognizedTool("mcp__some-server__deploy")).toBe(false);
  });
});

describe("classifyRisk — read-only bash downgrades to low", () => {
  it("tiers plain read-only commands low", () => {
    expect(classifyRisk("bash", { command: "ls -la" })).toBe("low");
    expect(classifyRisk("bash", { command: "cat README.md" })).toBe("low");
    expect(classifyRisk("bash", { command: "grep -rn foo src" })).toBe("low");
    expect(classifyRisk("bash", { command: "wc -l src/index.ts" })).toBe("low");
  });

  it("tiers read-only git subcommands low", () => {
    expect(classifyRisk("bash", { command: "git status" })).toBe("low");
    expect(classifyRisk("bash", { command: "git log --oneline -5" })).toBe("low");
    expect(classifyRisk("bash", { command: "git diff HEAD~1" })).toBe("low");
    expect(classifyRisk("bash", { command: "git -C /repo status" })).toBe("low");
  });

  it("tiers chains and pipes of read-only commands low", () => {
    expect(classifyRisk("bash", { command: "git status && git diff" })).toBe("low");
    expect(classifyRisk("bash", { command: "ls src | wc -l" })).toBe("low");
    expect(classifyRisk("bash", { command: "cat a.txt; cat b.txt" })).toBe("low");
  });

  it("tiers guarded find invocations low", () => {
    expect(classifyRisk("bash", { command: "find src -name '*.ts'" })).toBe("low");
  });
});

describe("classifyRisk — mutating or unknown bash stays critical", () => {
  it("keeps mutating commands critical", () => {
    expect(classifyRisk("bash", { command: "rm -rf tmp" })).toBe("critical");
    expect(classifyRisk("bash", { command: "npm install" })).toBe("critical");
    expect(classifyRisk("bash", { command: "chmod +x run.sh" })).toBe("critical");
  });

  it("keeps unknown commands critical", () => {
    expect(classifyRisk("bash", { command: "./deploy.sh" })).toBe("critical");
    expect(classifyRisk("bash", { command: "python3 script.py" })).toBe("critical");
  });

  it("keeps mutating git subcommands critical", () => {
    expect(classifyRisk("bash", { command: "git push origin main" })).toBe("critical");
    expect(classifyRisk("bash", { command: "git commit -m x" })).toBe("critical");
    expect(classifyRisk("bash", { command: "git stash" })).toBe("critical");
    expect(classifyRisk("bash", { command: "git branch new-branch" })).toBe("critical");
  });

  it("keeps mixed chains critical when any clause mutates", () => {
    expect(classifyRisk("bash", { command: "git status && git push" })).toBe("critical");
    expect(classifyRisk("bash", { command: "ls && rm -rf tmp" })).toBe("critical");
  });

  it("keeps missing or empty commands critical", () => {
    expect(classifyRisk("bash", {})).toBe("critical");
    expect(classifyRisk("bash", { command: "" })).toBe("critical");
    expect(classifyRisk("bash", { command: "   " })).toBe("critical");
  });
});

describe("classifyRisk — shell metacharacters disqualify the downgrade", () => {
  it("keeps redirections critical (read-only binary can still write)", () => {
    expect(classifyRisk("bash", { command: "cat a.txt > b.txt" })).toBe("critical");
    expect(classifyRisk("bash", { command: "echo hi >> log.txt" })).toBe("critical");
  });

  it("keeps command substitution critical", () => {
    expect(classifyRisk("bash", { command: "cat $(danger)" })).toBe("critical");
    expect(classifyRisk("bash", { command: "cat `danger`" })).toBe("critical");
  });

  it("keeps variable expansion critical (argument could be anything)", () => {
    expect(classifyRisk("bash", { command: "cat $FILE" })).toBe("critical");
  });

  it("keeps backgrounding critical (single & is not a clause separator)", () => {
    expect(classifyRisk("bash", { command: "ls & rm -rf tmp" })).toBe("critical");
  });

  it("keeps backslash escapes critical (could smuggle sensitive paths)", () => {
    expect(classifyRisk("bash", { command: "cat \\.env" })).toBe("critical");
  });

  it("keeps mutating find flags critical", () => {
    expect(classifyRisk("bash", { command: "find tmp -name '*.log' -delete" })).toBe("critical");
    expect(classifyRisk("bash", { command: "find src -exec rm {} +" })).toBe("critical");
  });

  it("keeps git --output critical (write path on a read subcommand)", () => {
    expect(classifyRisk("bash", { command: "git log --output=stolen.txt" })).toBe("critical");
  });
});

describe("classifyRisk — sensitive targets never downgrade", () => {
  it("keeps reads of builtin sensitive paths critical", () => {
    expect(classifyRisk("bash", { command: "cat .env" })).toBe("critical");
    expect(classifyRisk("bash", { command: "cat ./.env.local" })).toBe("critical");
    expect(classifyRisk("bash", { command: "head ~/.ssh/id_rsa" })).toBe("critical");
    expect(classifyRisk("bash", { command: "grep key server.pem" })).toBe("critical");
    expect(classifyRisk("bash", { command: "tail certs/tls.key" })).toBe("critical");
  });

  it("strips quotes before the sensitive check (no bypass via quoting)", () => {
    expect(classifyRisk("bash", { command: 'cat ".env"' })).toBe("critical");
    expect(classifyRisk("bash", { command: "cat '.env'" })).toBe("critical");
  });

  it("catches sensitive targets in any clause of a chain", () => {
    expect(classifyRisk("bash", { command: "ls && cat .env" })).toBe("critical");
  });
});

describe("classifyRisk — git revision/path sensitive reads", () => {
  it("keeps git show HEAD:.env critical", () => {
    expect(classifyRisk("bash", { command: "git show HEAD:.env" })).toBe("critical");
  });

  it("keeps git show main:.env critical", () => {
    expect(classifyRisk("bash", { command: "git show main:.env" })).toBe("critical");
  });

  it("keeps git show main:config/server.key critical", () => {
    expect(classifyRisk("bash", { command: "git show main:config/server.key" })).toBe("critical");
  });

  it("keeps git cat-file with sensitive path critical", () => {
    expect(classifyRisk("bash", { command: "git cat-file -p HEAD:.env" })).toBe("critical");
  });

  it("keeps git show HEAD:src/index.ts low risk", () => {
    expect(classifyRisk("bash", { command: "git show HEAD:src/index.ts" })).toBe("low");
  });

  it("keeps quoted git rev/path forms critical for sensitive paths", () => {
    expect(classifyRisk("bash", { command: "git show 'HEAD:.env'" })).toBe("critical");
  });

  it("keeps git show with stage path to sensitive file critical", () => {
    expect(classifyRisk("bash", { command: "git show :0:.env" })).toBe("critical");
  });

  it("keeps ambiguous revision syntax fail-safe (critical)", () => {
    expect(classifyRisk("bash", { command: "git show not~a~real~rev:.env" })).toBe("critical");
  });
});
