---
name: maintain-agents-md
description: Creates or updates AGENTS.md files for durable long-horizon coding agents. Use when asked to create, improve, weave in, or audit agent instructions, AGENTS.md, CLAUDE.md, GEMINI.md, Copilot instructions, or project-level LLM guidance.
---

<objective>
Create or update project agent instructions that help any coding LLM stay on task during long horizontal and vertical work. The skill turns project structure, tooling, conventions, validation gates, and long-horizon execution practices into a coherent `AGENTS.md` instead of a generic instruction dump.

This skill is LLM-provider and model agnostic. Do not name or optimize for a specific model family, vendor, product surface, or proprietary behavior unless the project already documents that integration as a tool-specific detail. The durable behaviors are universal: freeze scope, plan milestones, execute in small loops, validate, repair, document state, and isolate parallel streams.
</objective>

<quick_start>
When invoked, do this before editing:

1. Read `references/long-horizon-principles.md`.
2. Inspect the repository before writing an `AGENTS.md`.
3. If no `AGENTS.md` exists, create one from project evidence after reviewing the full project structure.
4. If an `AGENTS.md` exists, update it by weaving changes into the current structure, voice, and sections. Do not append a bolted-on long-horizon block unless no better integration point exists.
5. Keep all guidance provider/model agnostic.
</quick_start>

<essential_principles>
**Evidence before instructions:** Project instructions must come from the repository, not guesses. Inspect structure, package manifests, scripts, tests, config, docs, backend/frontend boundaries, and existing conventions.

**Durable memory over chat memory:** Long tasks need stable files for scope, plan, status, decisions, and validation outcomes. AGENTS.md should instruct agents when and how to create or update these files.

**Loop discipline:** Encode a repeating loop: plan, execute, validate, repair, document, repeat. A task milestone is not complete until verification has run and results are recorded.

**Horizontal and vertical task support:** Horizontal tasks use sequential milestones. Vertical tasks use isolated parallel streams with explicit merge contracts, separate validation, and final integration validation.

**Weave, do not bolt on:** Existing AGENTS.md files are living documents. Integrate new guidance into relevant sections, remove duplicated or contradictory wording, and preserve project-specific style.

**Provider/model agnostic:** Say "agent", "LLM", or "coding assistant". Avoid vendor-specific names and model-specific capability claims. Tool-specific commands are acceptable only when they are project-local facts.
</essential_principles>

<workflow>
1. **Find instruction files:** Locate `AGENTS.md` first. Also note related files such as `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursor/rules`, `README.md`, and project docs, but do not duplicate their contents blindly.

2. **Map the project:** Review the full directory structure and key files. Identify stack, package manager, scripts, test commands, lint/typecheck/build commands, app entrypoints, backend services, schema or migration systems, deployment/config surfaces, and important docs.

3. **Classify the operation:** If `AGENTS.md` is missing, create a complete project-specific guide. If it exists, update it in place and preserve its established organization unless that organization is actively harming clarity.

4. **Design the instruction architecture:** Ensure the document covers quick start, project architecture, conventions, validation gates, long-horizon execution, durable state files, horizontal tasks, vertical tasks, repair-forward behavior, recovery/re-entry, and project-specific warnings.

5. **Write or weave:** Create polished prose that a fresh LLM can follow without prior chat context. For existing documents, merge related concepts into existing sections, tighten duplicates, and avoid a disconnected appendix.

6. **Validate:** Check that the resulting file is internally consistent, provider agnostic, and grounded in the repository. If the project has formatting checks for markdown, run them when practical. At minimum, reread the changed file and inspect the diff.

7. **Report:** Summarize what was created or changed, the project evidence used, and any residual uncertainty or follow-up needed.
</workflow>

<document_requirements>
An effective `AGENTS.md` should include:

- Project identity and current status
- Quick-start orientation steps for agents
- Stack, architecture, and important directories
- Coding conventions and design/system constraints
- Data, state, API, or persistence rules specific to the project
- Test, lint, typecheck, format, build, and deploy validation commands
- Long-horizon execution model for multi-step tasks
- Rules for creating or updating durable state files such as spec, plan, and status logs
- Horizontal task flow for sequential milestones
- Vertical task flow for parallel branches or worktrees
- Repair-forward protocol for failed validation
- Re-entry protocol for interrupted or compacted sessions
- Scope-drift handling
- Project-specific never/always rules
</document_requirements>

<anti_patterns>
Avoid these failures:

- Creating a generic AGENTS.md without inspecting the repository
- Appending a pasted long-horizon section to an existing AGENTS.md without integrating it
- Mentioning a specific LLM provider or model as a dependency for the workflow
- Inventing validation commands that do not exist without marking them as recommendations
- Treating tests as final cleanup instead of milestone gates
- Allowing parallel work without isolation, merge contracts, and post-merge validation
- Leaving conflicting instructions in separate sections
- Relying on chat context for state that must survive long tasks
</anti_patterns>

<reference_index>
Read `references/long-horizon-principles.md` whenever creating, updating, or auditing an AGENTS.md for long-running agent work.
</reference_index>

<success_criteria>
The skill is successful when:

- `AGENTS.md` exists or is updated in place
- The file is grounded in the actual project structure and commands
- Long-horizon execution is expressed as a repeatable, verifiable loop
- Horizontal and vertical task guidance is clear and operational
- Durable state files are specified for tasks large enough to need them
- Existing AGENTS.md guidance is woven together rather than bolted on
- The result contains no unnecessary provider/model-specific assumptions
</success_criteria>
