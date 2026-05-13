---
name: codebase-deslop
description: Run a full-codebase cleanup/refactor/deslop workflow with scan-based todo planning and thorough reporting
---

# Codebase Deslop Skill

Reduce AI-generated slop with a regression-tests-first, scan-driven cleanup workflow that preserves behavior, improves code quality, and produces a thorough report of findings, fixes, removals, verifications, and remaining risks.

## Purpose

Use this skill to inspect and clean AI-generated or AI-degraded code without drifting into uncontrolled rewrites. The goal is to remove noise, duplication, dead code, weak abstractions, contract drift, and cross-layer inconsistency while preserving behavior and documenting exactly what was found, changed, removed, verified, and deferred.

## When to Use

Use this skill when:
- A code path works but feels bloated, noisy, repetitive, fragile, or over-abstracted
- A user asks to “cleanup”, “refactor”, “deslop”, “tighten”, or “make this production-grade”
- A project has inconsistent frontend/backend/schema/test boundaries
- Generated code introduced duplicate helpers, dead files, weak naming, stale branches, wrapper-heavy logic, or poor separation of concerns
- You need a disciplined cleanup workflow with explicit verification and reporting
- You must inspect an entire project codebase from top to bottom and not miss frontend, backend, schemas, contracts, tests, configs, scripts, or related layers

## Operating Modes

### 1. Scoped Mode
Use when the caller gives:
- a file list
- a changed-files list
- a feature area
- a route/module/service boundary

In scoped mode, keep the cleanup strictly bounded to the provided scope.

### 2. Whole-Codebase Mode
Use when the caller asks for a repo-wide cleanup, audit, deslop pass, or project review.

In whole-codebase mode, inspect the repository top to bottom before editing. Do not assume only source files matter. Review all relevant layers, including:
- Frontend app structure, routes, pages, components, hooks, state, styling, forms, and client data fetching
- Backend routes, controllers, handlers, services, jobs, queues, middleware, auth, validation, and error handling
- Schemas and contracts, including database schema, ORM models, migrations, DTOs, validation schemas, generated types, and API contracts
- Shared code such as utilities, constants, adapters, mappers, feature flags, and environment access
- Tests, fixtures, mocks, regression coverage, integration coverage, and edge-case coverage
- Project glue such as package manifests, scripts, lint config, type config, build config, CI wiring, deployment-adjacent config, and other places where slop or duplication can hide

If a layer exists, inspect it. If a layer is absent, state that explicitly in the report.

## GPT-5.4 Guidance Alignment

- Keep outputs concise by default, but be exhaustive in inspection and evidence.
- Treat newer user instructions as local workflow updates without discarding earlier non-conflicting constraints.
- Keep using inspection, tests, diagnostics, and verification until the cleanup is grounded.
- Proceed automatically through clear, reversible cleanup steps; ask only when a choice materially changes scope or behavior.
- Prefer small, verified passes over broad rewrites.
- Report every meaningful finding, every removal, and every deferred issue.

## Scoped File Lists and Ralph Workflow

- This skill can accept a file-list scope instead of a whole feature area.
- When the caller provides a changed-files list, keep the cleanup strictly bounded to those files unless the caller explicitly expands scope.
- In the Ralph workflow, the mandatory deslop pass should run this skill on Ralph’s changed files only, in standard mode unless the caller explicitly requests whole-codebase mode.
- Even in file-list mode, identify adjacent dependencies and boundary risks, but do not edit outside scope unless explicitly approved.

## Mandatory Recon and Scan Phase

Before editing, perform a repository reconnaissance and findings scan.

### Recon goals
- Detect stack, framework, package manager, and test/lint/typecheck tooling
- Identify project entrypoints and execution paths
- Map the major layers of the system
- Find high-risk zones where slop usually hides
- Determine whether cleanup should run in scoped mode or whole-codebase mode

### Recon checklist
- Package manifests and workspace structure
- App entrypoints and routing surfaces
- Frontend module/page/component organization
- Backend module/service/handler organization
- Schema/model/validation/migration locations
- Shared utilities and adapter layers
- Test locations and current coverage signals
- Build, lint, typecheck, CI, and script surfaces
- Generated files vs owned source files
- Dead directories, legacy folders, abandoned experiments, and duplicate implementations

Do not start cleanup until the codebase map and findings are explicit.

## Mandatory Todo Checklist Before Edits

After the scan and findings review, create a todo checklist before making any fixes, deletions, or refactors.

The checklist must:
- Be derived from actual findings, not guesses
- Group items by layer when relevant: frontend, backend, schemas/contracts, shared code, tests, config/tooling
- Mark each item as one of: fix, remove, verify, or defer
- Order items from safest/highest-signal to riskiest
- Identify behavior-lock requirements before any destructive edits
- Note dependencies between items when one cleanup depends on another
- Be used as the execution plan for the cleanup pass

Do not start edits until the todo checklist is explicit.

## Workflow

### 1. Run recon and scan
- Map the repository and identify all relevant layers
- Record findings before changing code
- Distinguish confirmed findings from suspected issues

### 2. Create the todo checklist from findings
- Turn findings into an explicit checklist
- Group by layer and smell category
- Mark items as fix, remove, verify, or defer
- Order the work from safest to riskiest
- Call out destructive changes that require behavior lock first

### 3. Lock behavior with regression tests first
- Identify the behavior that must not change
- Add or run targeted regression tests before editing cleanup candidates
- If behavior is currently untested, create the narrowest test coverage needed first
- In whole-codebase mode, lock the most critical user-visible and contract-critical paths first

### 4. Create an explicit cleanup plan before code
- State the scope
- State the repo areas inspected
- List the specific smells to remove
- Group findings by layer
- Reference the todo checklist as the execution plan
- Order fixes from safest/highest-signal to riskiest
- If a file-list scope is provided, keep edits restricted to that list unless approval is given

### 5. Audit each layer before and during editing

#### Frontend
Check for:
- Duplicate components, duplicate hooks, and duplicate view logic
- Dead pages, dead routes, unused props, stale state, and abandoned UI branches
- Wrapper-heavy abstractions with little value
- Repeated fetch, state, error, and loading logic that should be simplified
- Weak accessibility or inconsistent UX/error handling introduced by generated code
- Styling duplication, token drift, and inconsistent patterns

#### Backend
Check for:
- Duplicate handlers, services, or controller logic
- Dead endpoints, stale branches, and unreachable code
- Pass-through service layers with no meaningful boundary
- Weak error handling, inconsistent validation, and hidden side effects
- Wrong-layer responsibilities and import coupling

#### Schemas and contracts
Check for:
- Drift between database schema, ORM models, validators, DTOs, API types, and frontend assumptions
- Duplicate schema definitions
- Stale migrations or dead model fields
- Validation gaps and naming mismatches
- Contract breakage risks hidden by casts, defaults, or fallback logic

#### Shared code and utilities
Check for:
- Utility sprawl
- One-off helpers that should be inlined
- Duplicate mappers, parsers, and formatters
- Constants or config split across too many locations
- Hidden environment assumptions

#### Tests
Check for:
- Missing regression coverage
- Brittle tests that encode implementation instead of behavior
- Duplicate test setup and stale fixtures
- Gaps around error paths, contracts, and edge cases

#### Config, scripts, and tooling
Check for:
- Redundant scripts
- Unused dependencies
- Legacy config and dead toggles
- Mismatched lint/type/test settings
- Broken, stale, or misleading project scripts

If a layer is present, inspect it. If not inspected, say so in the report.

## Smell Categories

Categorize issues before editing:

- **Dead code** — unused files, unused exports, unreachable branches, stale flags, and debug leftovers
- **Duplication** — repeated logic, copy-paste branches, parallel implementations, and redundant helpers
- **Needless abstraction** — pass-through wrappers, speculative indirection, fake service boundaries, and single-use helper layers
- **Boundary violations** — hidden coupling, wrong-layer imports, leaky responsibilities, and cross-layer reach-through
- **Schema/contract drift** — mismatched validators, types, DTOs, ORM models, migrations, and frontend assumptions
- **Naming and clarity debt** — vague names, misleading modules, and muddy responsibilities
- **Test debt** — behavior not locked, weak regression coverage, and missing contract or edge-case coverage
- **Config/tooling slop** — stale scripts, unused dependencies, dead config, and redundant build glue

## Execute passes one smell at a time

Run cleanup in small, reversible passes. Re-run targeted verification after each pass.

### Pass 1: Dead code deletion
- Remove dead files, dead exports, dead branches, stale flags, and debug leftovers
- Record every deletion and why it was safe

### Pass 2: Duplicate removal
- Merge duplicate logic
- Remove redundant helpers, repeated branches, and parallel implementations
- Prefer the simplest surviving implementation

### Pass 3: Boundary and abstraction cleanup
- Remove pass-through wrappers and speculative indirection
- Repair wrong-layer ownership
- Tighten interfaces between frontend, backend, and schemas
- Reduce hidden coupling

### Pass 4: Naming and error-handling cleanup
- Improve naming, module clarity, and failure behavior
- Standardize validation and error paths where needed
- Keep diffs scoped and behavior-preserving

### Pass 5: Test reinforcement
- Add or strengthen regression coverage around all touched risk areas
- Add contract and path tests for cleaned boundaries
- Remove or repair brittle or stale tests

Avoid bundling unrelated refactors into the same edit set.

## Quality Gates

Run the relevant gates after each major pass and again at the end.

Required when available:
- Regression tests stay green
- Lint passes
- Typecheck passes
- Relevant unit tests pass
- Relevant integration tests pass
- Build passes
- Static/security scan passes when available
- Diff stays minimal and scoped
- No new abstractions or dependencies unless explicitly required

In whole-codebase mode, note which gates were project-wide versus targeted.

## Reporting Requirements

The final report must be thorough. Do not give a minimal summary.

Always report:
- Scope requested
- Mode used: scoped or whole-codebase
- Repo areas inspected
- Repo areas not inspected, if any, and why
- Behavior locks added or run
- Full cleanup plan
- The todo checklist used for execution
- Findings by layer
- Every file changed
- Every file removed
- Every major simplification
- Every contract or schema mismatch fixed
- Every verification step run
- Remaining risks
- Deferred follow-ups
- Suspected slop left untouched due to scope or risk

For removals, state:
- what was removed
- where it was removed from
- why it was safe to remove
- what verification supports the removal

## Output Format

```text
CODEBASE DESLOP REPORT
======================

Scope Requested: [files / feature / whole project]
Mode Used: [Scoped | Whole-Codebase]

Repository Recon:
- Stack/framework/tooling: [...]
- Entrypoints identified: [...]
- Layers inspected: [...]
- Layers not present or not inspected: [...]

Scan Findings Summary:
- [high-level findings]

Todo Checklist:
- [ ] [layer] [fix/remove/verify/defer] [item]
- [ ] [layer] [fix/remove/verify/defer] [item]

Behavior Lock:
- Existing tests run: [...]
- Regression tests added: [...]
- Critical behaviors protected: [...]

Cleanup Plan:
- Pass order: [...]
- Smells targeted: [...]
- Boundaries/special risk areas: [...]

Findings by Layer:
- Frontend:
  - [finding]
- Backend:
  - [finding]
- Schemas/Contracts:
  - [finding]
- Shared/Utilities:
  - [finding]
- Tests:
  - [finding]
- Config/Scripts/Tooling:
  - [finding]

Passes Completed:
1. Pass 1: Dead code deletion
   - [change]
2. Pass 2: Duplicate removal
   - [change]
3. Pass 3: Boundary and abstraction cleanup
   - [change]
4. Pass 4: Naming/error-handling cleanup
   - [change]
5. Pass 5: Test reinforcement
   - [change]

Removals Ledger:
- [path/item] - removed because [...]
- [path/item] - removed because [...]

Changed Files:
- [path] - [what changed and why]

Verification:
- Regression tests: PASS/FAIL
- Lint: PASS/FAIL
- Typecheck: PASS/FAIL
- Unit tests: PASS/FAIL
- Integration tests: PASS/FAIL
- Build: PASS/FAIL
- Static/security scan: PASS/FAIL or N/A

Remaining Risks:
- [risk]

Deferred Follow-Ups:
- [follow-up]

Untouched but Suspect:
- [area left untouched because scope/risk/time]
```

## Good Behavior

**Good:** Start with recon, map the codebase, record findings, create the todo checklist, lock critical behavior, and then clean one smell category at a time with verification after each pass.

**Good:** In whole-codebase mode, inspect frontend, backend, schemas, tests, and config even if the first obvious slop is only in one layer.

**Good:** Remove dead code aggressively when evidence supports safety, but log every removal.

**Good:** Keep scoped mode tightly bounded while still reporting adjacent risks.

## Bad Behavior

**Bad:** Start rewriting architecture before behavior is protected.

**Bad:** Start making edits immediately after scanning without first creating a todo checklist from findings.

**Bad:** Clean only visible UI files while ignoring services, schemas, validators, tests, and scripts.

**Bad:** Make large mixed refactors with no pass boundaries or verification.

**Bad:** Give a short report that omits removals, findings, uninspected areas, or deferred risks.
