<overview>
Long-horizon agent work succeeds because of operating discipline, not because of a single large prompt. The agent needs a stable target, checkpointed work, externalized state, repeated validation, repair-forward behavior, and clear re-entry instructions.
</overview>

<core_loop>
Use this loop for every non-trivial milestone:

1. **Plan:** Define the next bounded unit of work and the validation that proves it is done.
2. **Execute:** Make the smallest coherent change set that satisfies the milestone.
3. **Validate:** Run the relevant tests, type checks, lint checks, format checks, builds, previews, or smoke tests.
4. **Repair:** If validation fails, read the actual output, fix the root cause with the smallest correct change, and rerun validation.
5. **Document:** Update durable state with completed work, decisions, validation results, blockers, and future work.
6. **Repeat:** Move to the next milestone only after the current gate is green or explicitly blocked.
</core_loop>

<durable_project_memory>
Long tasks need files that survive context loss and handoffs. AGENTS.md should define when these are required and where they live.

Recommended files for large tasks:

- `SPEC.md`: frozen scope, deliverables, constraints, non-goals, and done criteria
- `PLAN.md`: milestone sequence, acceptance criteria, validation commands, and dependency order
- `STATUS.md`: current milestone, completed milestones, decisions, validation results, blockers, and future work

Projects can choose different names or place these under `docs/`, `.agent/`, `.ai/`, or a task directory. The important rule is that the source of truth is explicit and durable.
</durable_project_memory>

<horizontal_tasks>
Horizontal tasks are long sequential efforts with one main thread of execution.

AGENTS.md should instruct agents to:

- Freeze scope before implementation starts
- Break work into small milestones with acceptance criteria
- Run validation after each milestone, not just at the end
- Repair failures before advancing
- Update status after every milestone
- Log newly discovered work as future work unless the user explicitly expands scope
- Stop and report after repeated failed repair attempts rather than patching blindly
</horizontal_tasks>

<vertical_tasks>
Vertical tasks split into independent branches or parallel work streams.

AGENTS.md should instruct agents to:

- Define a merge contract before splitting work
- Identify what each branch owns and what it must produce
- Use isolated worktrees, branches, task directories, or clearly separated change sets where supported
- Run validation independently in each stream
- Merge only after streams meet their contracts
- Run full integration validation after merge
- Record conflicts, decisions, and remaining risks in durable status
</vertical_tasks>

<verification_gates>
Validation gates should be project-specific and evidence based. Derive them from package scripts, build tooling, CI, docs, and existing tests.

Common gate categories:

- Typecheck or compile
- Lint
- Format check
- Unit tests
- Integration tests
- End-to-end or browser tests
- Build/package/export
- Database schema or migration verification
- Static analysis or security scans
- Manual smoke test for user-visible flows

Do not invent commands as facts. If a desirable check is missing, label it as a recommended addition or ask whether to add it.
</verification_gates>

<repair_forward>
Repair-forward keeps long tasks from drifting during failures.

Rules to encode:

- Read full error output before changing code
- Fix the root cause, not symptoms
- Prefer the smallest correct change
- Rerun the failed validation immediately
- Track repeated attempts and stop after the project-defined threshold
- Record the blocker, output, and attempted fixes before escalating
- Never hide failing validation behind a completion claim
</repair_forward>

<re_entry_and_context_loss>
Long tasks must survive interruption, context compaction, and handoff.

AGENTS.md should define a re-entry protocol:

- Read status files first
- Read the plan and spec before editing
- Check current git status without reverting unrelated changes
- Run a lightweight validation or health check to understand current state
- Continue from the last incomplete milestone
- Ask the user only when state files conflict, scope is unclear, or the next action is destructive
</re_entry_and_context_loss>

<weaving_existing_agents_md>
When updating an existing AGENTS.md, integration quality matters more than adding volume.

Use this approach:

- Preserve project-specific conventions, voice, and section names when useful
- Insert long-horizon guidance into existing planning, validation, testing, recovery, and workflow sections
- Replace duplicated guidance with one clearer version
- Resolve contradictions explicitly instead of leaving both instructions
- Keep examples aligned with the project stack and commands
- Avoid a generic appendix that readers can skip or that conflicts with earlier sections
</weaving_existing_agents_md>

<provider_agnostic_language>
Use durable, neutral language:

- Prefer "agent", "LLM", "assistant", "coding agent", or "model"
- Prefer "agent harness", "tool loop", "workspace", or "execution environment"
- Avoid capability claims tied to one vendor or model
- Avoid requiring a specific provider for planning, reasoning, verification, or context management
- Mention specific tools only as project facts, such as package managers, framework commands, CI systems, or repo-local agent harnesses
</provider_agnostic_language>

<source_article_takeaways>
The OpenAI long-horizon task write-up demonstrates these generalizable patterns:

- Time horizon improves when agents run inside a disciplined loop with feedback from tools
- Durable project memory prevents drift better than relying on chat context
- A spec freezes the target so the agent does not build impressive but wrong features
- A plan turns open-ended work into checkpointed milestones
- A runbook tells the agent how to operate during execution
- A status or documentation file keeps progress inspectable over hours or handoffs
- Verification must happen at every milestone and failures must be repaired before continuing
- Parallel threads or worktrees help isolate long work and keep diffs reviewable

Apply these as provider-agnostic engineering patterns, not as vendor-specific instructions.
</source_article_takeaways>
