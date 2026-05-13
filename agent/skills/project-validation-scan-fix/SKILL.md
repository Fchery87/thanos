---
name: project-validation-scan-fix
description: Scans an entire codebase with configurable profiles to detect frameworks, run linters/tests, compute a health score, generate a task list, and iteratively work toward a "perfectionist" state.
version: 2.0.0
metadata:
  tags: [code, validation, linting, debugging, automation, refactor, ci, quality-gate]
  author: "Frantz Chery (Adapted for Factory)"
---

# Project Validation Scan & Fix (Perfectionist Edition)

## Purpose

This skill turns the agent into a **configurable project health engine** for codebases.

It must:

- Scan the entire project (or a specified sub-tree) to:
  - Detect **languages, frameworks, and tooling**.
  - Discover and run **lint, test, type-check, build, coverage, and security** commands.
- Use **profiles** (e.g., `quick`, `full`, `perfectionist`) defined in a config file to control depth and cost.
- Compute a **Validation Health Score** for each scan and track progress over time.
- Generate and maintain a single **validation task hub** (`VALIDATION_TASKS.md`) with all issues.
- Apply **risk-aware automatic fixes** (tiered) and re-run relevant checks.
- Optionally produce a **machine-readable report** (`validation-report.json`) for CI / automation.

The end goal is to push the project toward a clearly defined **Perfectionist State** while remaining fast, safe, and repeatable.

---

## Perfectionist State definition

The skill must treat "perfectionist" not as a vibe but as a contract.

A project is considered in **Perfectionist State** for a given profile when all of the following are true:

1. All validation commands configured for that profile **run and pass**.
2. There are **no `critical` or `high` severity tasks** remaining.
3. The **Validation Health Score** is at or above the configured target (e.g., >= 95/100).
4. If coverage tools are configured:
   - Overall test coverage meets or exceeds the configured minimum (e.g., 80-90%).
5. There are **no unresolved security/secrets tasks**.

The skill must explicitly state whether the project currently meets Perfectionist State and, if not, what is missing.

---

## Profiles and modes

The skill must support **scan profiles** that trade depth vs speed.

### Default profiles

If no config file exists, the skill must assume these default behaviors:

- **quick**
  - Focuses on **changed code only** when git is available.
  - Runs light commands such as lint and selected tests if they exist.
- **full**
  - Runs all discovered standard validation commands across the project (lint, type-check, tests, build).
- **perfectionist**
  - Same as `full`, plus:
    - Coverage checks (if available).
    - Security/secret heuristics.
    - Stricter thresholds for health score and remaining tasks.

### Config-based profiles

If a `validation.config.json` or `validation.config.yaml` exists at the repo root, the skill must:

- Parse it as the **source of truth** for:
  - Profiles and their commands.
  - Coverage thresholds.
  - Exclusion patterns.
  - Severity overrides.
  - CI behavior.
- Use the `perfectionistProfile` value (if present) to know which profile represents "perfectionist mode".

If a user does not specify a profile, the skill must:

- Default to `perfectionistProfile` from config when present.
- Otherwise default to `full`.

---

## When to use this skill

Activate this skill when the user:

- Wants a **project-wide quality/validation scan**.
- Wants a **task list** of all validation, coverage, and quality issues.
- Wants the agent to **auto-fix safe issues**, re-run checks, and report on project health.
- Wants to understand **how far** a project is from a perfectionist state and how to close the gap.
- Wants a **CI-ready report** or quality gate behavior.

Typical prompts:

- "Run a perfectionist validation scan on this repo and fix what you safely can."
- "Give me a quick validation on only my recent changes."
- "Generate a CI-style validation report and tasks for this project."

---

## When not to use this skill

**Must not** use this skill:

- For single-file questions ("Explain this function", "Refactor just this file") unless explicitly asked to consider the whole repo.
- When the user forbids running commands, tests, or linters.
- To run **arbitrary or destructive shell commands**, such as:
  - Installing dependencies without user consent.
  - Running long-lived dev servers.
  - Modifying files outside the project root.
- To claim perfect correctness; it provides **best-effort validation**, not formal proofs.

---

## Core behavior and priorities

1. **Config-driven, project-wide perspective**
   - Prefer honoring `validation.config.*` over heuristics when present.
   - Always consider the **whole repo**, but adapt scope based on profile (e.g., changed-files-only in `quick`).

2. **Safety and containment**
   - Run all commands from the **project root** or clearly documented subdirectories.
   - Limit `Execute` usage to inspection and validation commands (lint/test/build/coverage/security).
   - Never execute arbitrary scripts or dev servers by default.

3. **Framework-aware validation**
   - Detect languages and frameworks via files and dependencies.
   - Prefer **native validation commands** or project-specific scripts (`npm run lint`, `pytest`, `mvn test`, etc.).

4. **Tiered auto-fix policy**
   - **Tier 1 (Safe)** -- default, auto-apply:
     - Remove unused imports, variables.
     - Trivial lint fixes (formatting, obvious syntax).
     - Non-behavioral type annotations where the intent is clear.
   - **Tier 2 (Moderate)** -- propose by default; only apply when user opts in:
     - Adjusting test expectations.
     - Small behavior changes or function signature tweaks.
   - **Tier 3 (Risky)** -- never auto-apply; only propose:
     - Large refactors, complex control-flow changes, security-sensitive changes.

5. **Security and secrets awareness**
   - Look for obvious secrets and insecure patterns.
   - Never auto-fix by deleting secrets; instead, create high/critical tasks with guidance.

6. **Health score and progress**
   - Compute a **Validation Health Score** from 0-100 using:
     - Failing commands.
     - Count and severity of tasks.
     - Coverage shortfalls compared to configured thresholds.
   - Track score and scan history in `VALIDATION_TASKS.md`.

7. **Single task hub**
   - Maintain `VALIDATION_TASKS.md` at the repo root (or from config).
   - Treat it as the **canonical overview** of project validation state.
   - Update task statuses and scan history on each run.

---

## Process (step-by-step)

The skill must follow this structured process.

### 1. Interpret user request and choose profile

1.1. Extract from the user request:

- Requested **scope** (default: repo root).
- Requested **profile**: `quick`, `full`, `perfectionist`, `ci`, etc.
- Auto-fix boundaries:
  - Apply only Tier 1 by default.
  - Consider Tier 2 only if user explicitly requests deeper fixes.
  - Never auto-apply Tier 3.

1.2. If no profile is specified:

- If config exists, use `perfectionistProfile` or `full`.
- Otherwise default to `full`.

### 2. Load validation config (if present)

2.1. Look for `validation.config.json` or `validation.config.yaml` at project root.

2.2. If found:

- Parse it and extract:
  - `profiles` and their commands.
  - `perfectionistProfile` name.
  - `exclude` patterns.
  - `severityOverrides` map.
  - `coverage` thresholds.
  - `ci` behavior (e.g., fail conditions, output path).

2.3. If not found:

- Use built-in defaults for profiles and thresholds.
- Recommend adding a config in the tasks list.

### 3. Detect languages, frameworks, and tools

3.1. Use `Read` to inspect top-level files/directories and key configs.

3.2. Identify:

- Languages (TS/JS, Python, Java, Go, etc.).
- Frameworks (React, Next.js, Django, FastAPI, Spring Boot, etc.).
- Available tools (eslint, jest, pytest, mypy, ruff, bandit, etc.).

3.3. Record detections for inclusion in:

- `VALIDATION_TASKS.md` header.
- `validation-report.json` under `techStack`.

### 4. Determine scope and change set

4.1. Scope:

- Honor user-specified subdirectory if provided.
- Otherwise, operate on the project root.

4.2. Change set (for incremental behavior):

- If git is available, and the profile is `quick` or the config says to prefer changed-files:
  - Use commands like `git diff --name-only <base>` (e.g., `main` or `origin/main`) to determine changed files.
  - Tag tasks related to these files with `scope: "changed"`.
- If git is unavailable or diff fails, fall back to full scan semantics.

### 5. Discover validation commands

5.1. From config:

- For the chosen profile, use the commands listed in `profiles[profile].commands` in order.

5.2. Heuristically:

- If no config or profile commands are defined, derive commands using standard conventions per ecosystem.

5.3. Classify commands by type:

- `lint`, `test`, `type`, `build`, `coverage`, `security`, `custom`.

### 6. Execute validation commands

Using `Execute`:

6.1. Run each selected command from the project root (or documented subdirectory).

6.2. For each command:

- Capture:
  - Command string.
  - Exit code.
  - Key portions of stdout/stderr.
- If it fails:
  - Parse error messages for file paths, line numbers, and error codes.
  - Create one or more tasks describing the issue.

6.3. For coverage commands:

- Parse resulting coverage summary:
  - Overall coverage.
  - Per-module coverage where available.
- Compare against configured thresholds and create tasks if below target.

6.4. For security commands or heuristics:

- Detect obvious secrets and insecure patterns.
- Create tasks with `category: "security"` or `category: "secrets"` and high/critical severity.
- Do not auto-fix.

### 7. Build the findings list

The skill must aggregate findings into a list of **tasks**, where each task includes at least:

- `id`: short unique identifier, e.g., `TASK-001`.
- `severity`: `critical` | `high` | `medium` | `low`.
- `category`: e.g., `lint`, `test`, `type`, `build`, `coverage`, `config`, `security`, `secrets`, `code-smell`, `docs`.
- `scope`: `changed` | `legacy` | `global`.
- `location`: file path (and line range where possible).
- `summary`: short human-readable explanation.
- `details`: key error messages or context.
- `suggestedFix`: concise guidance.
- `status`: `todo` | `in-progress` | `done` | `blocked`.
- Optional:
  - `owner`: inferred or left blank for humans to fill.
  - `subsystem`: e.g., `frontend`, `backend`, `infra`.

Severity must respect `severityOverrides` from config when applicable.

### 8. Compute Validation Health Score

8.1. Conceptually compute a 0-100 score using:

- Start from 100.
- Deduct points for:
  - Each failing command (weighted by type and importance).
  - Each open task, weighted by severity.
  - Coverage shortfalls compared to configured thresholds.
- Cap deductions so score is not less than 0.

8.2. Report the score in:

- `VALIDATION_TASKS.md` header.
- `validation-report.json` under `health.score`.

8.3. Determine whether the perfectionist state conditions are met and record:

- `health.meetsPerfectionistState: true/false`.
- If false, a list of blocking reasons (e.g., "failing tests", "critical tasks remain", "coverage below threshold").

### 9. Write/update `VALIDATION_TASKS.md`

9.1. Target file:

- Default: `VALIDATION_TASKS.md` at project root.
- If config provides a custom path, use that instead.

9.2. Behavior:

- If file exists:
  - Merge new tasks with existing ones when IDs or locations match.
  - Update status of tasks that were resolved during this run.
  - Append a new entry to the **Scan History** section.
- If file does not exist:
  - Create it with the proper structure.

9.3. The file must include:

- Header metadata:
  - Time of last scan.
  - Selected profile.
  - Validation Health Score and target threshold.
  - Whether perfectionist state is currently reached.
  - Detected tech stack.
  - Summary of commands executed and their exit status.
- A **task table** with at least:
  - ID, Status icon, Severity, Category, Scope, Location, Summary.
- A **Task Details** section with richer info per task.
- A **Scan History** section listing previous scan dates, profiles, and scores.

### 10. Auto-fix tasks (tiered)

10.1. For Tier 1 issues:

- Apply fixes automatically using `Edit`, respecting the project's style and conventions.
- Re-run the **smallest relevant validation command** (e.g., specific linter or test) where practical.
- Update corresponding tasks to `done` when resolved.

10.2. For Tier 2 issues:

- By default, only propose fixes:
  - Write detailed `suggestedFix` in the task details.
  - Optionally provide patch previews in the chat.
- If the user explicitly asks to apply Tier 2 fixes:
  - Carefully apply them in small, reviewable patches.
  - Re-run relevant validation commands.

10.3. For Tier 3 issues:

- Never auto-apply.
- Provide thorough guidance and potential implementation strategies.

### 11. Optional JSON report and CI mode

11.1. When user requests CI output or config enables CI mode:

- Emit `validation-report.json` at the project root (or configured path).
- Include:
  - Overall health.
  - Per-profile/per-command status.
  - Task list.
  - Perfectionist state info.

11.2. Provide a final one-line summary suitable for CI logs, e.g.:

> `VALIDATION: profile=perfectionist score=92 critical=0 high=1 medium=4 low=10 meetsPerfectionist=false`

CI pipelines can then parse this line or the JSON report to enforce gates.

---

## Research for Best Practices
When investigating validation issues or finding best practices for specific frameworks/languages, use the mgrep skill with web search:

```bash
# Example: Research best practices for a specific framework
mgrep --web --answer "TypeScript ESLint best practices 2024"

# Example: Find testing patterns for a framework
mgrep --web --answer "React Testing Library best practices Jest"

# Example: Look up coverage thresholds recommendations
mgrep --web --answer "code coverage thresholds best practices CI"
```

---

## Output formats

### 1. `VALIDATION_TASKS.md`

- Primary human-facing artifact.
- Includes header with health score, tech stack, scan history.
- Task table and detailed task descriptions.

### 2. `validation-report.json`

- Optional machine-readable report.
- Useful for CI, dashboards, or external tooling.

---

## Examples

### Example 1 - Interactive: Full perfectionist scan
**User:** "Run a perfectionist validation scan on this repo and fix what you can."

**Expected output:**
- Detection of tech stack and available validation tools.
- Execution of lint, test, type-check, build commands.
- Health score calculation (e.g., 87/100).
- Task list with all issues found.
- Auto-fixes for Tier 1 issues (unused imports, formatting).
- Manual guidance for Tier 2/3 issues.

### Example 2 - Quick scan on changed files
**User:** "Give me a quick validation on only my recent changes."

**Expected output:**
- Git diff to identify changed files.
- Targeted lint/test on changed files only.
- Focused task list for changed scope.
- Health score delta from baseline.

### Example 3 - CI mode with JSON report
**User:** "Generate a CI-style validation report."

**Expected output:**
- `validation-report.json` with machine-readable findings.
- One-line summary for CI logs.
- Exit status recommendation based on thresholds.
