# ADR 0003 — Thanos expands as an extension-first agent distribution

**Status:** Accepted

## Context

Thanos was previously described primarily as a Team-grade Governance Layer for Pi: policy, audit, verification, and subagent delegation layered onto a local Pi installation.

The product comparison target has changed. Oh-my-pi demonstrates a broader agent distribution model with features such as typed user interaction, richer task tracking, structured review flows, runtime tools, virtual filesystems, model routing, memory, browser automation, and protocol integrations. The user wants Thanos to learn from that model rather than remain constrained to governance-only features.

That creates a strategic boundary question. Thanos can either:

1. stay governance-only and treat broad productivity/runtime tools as out of scope;
2. fork or replace the underlying agent runtime and own a full Oh-my-pi-style CLI implementation;
3. become a broader Pi-based Agent Distribution while keeping governance as a differentiating pillar;
4. split into a governance core plus optional productivity extensions.

The implementation strategy also matters. Forking the runtime unlocks deep features but makes Thanos responsible for model providers, terminal UI, native tooling, protocol modes, tool plumbing, cross-platform behavior, and long-term compatibility. Staying extension-first preserves maintainability, but some capabilities may eventually require vendoring or forking narrow runtime pieces if Pi's extension API cannot support them safely or ergonomically.

## Decision

Thanos will expand from a governance-only layer into a broader Pi-based **Agent Distribution**.

Governance remains a first-class differentiator, not a discarded constraint. Thanos should add productivity, review, interaction, memory, tool, protocol, and workflow capabilities when they improve the local agent experience and can be made compatible with policy, audit, and verification.

Use an **Extension-first Hybrid Strategy**:

- Prefer Pi extension APIs, slash commands, MCP configuration, policy files, installer bundles, skills, and local configuration.
- Classify borrowed Oh-my-pi-inspired capabilities as `configure`, `extend`, `wrap`, `vendor`, or `fork`.
- Default to `configure`, `extend`, or `wrap`.
- Allow `vendor` or `fork` only when a required capability is impossible, unsafe, or ergonomically broken through the extension surface.
- When vendoring or forking is necessary, copy or own the smallest subsystem required rather than adopting the full runtime.

The first capability tranche is **Governed Interaction Primitives**:

1. **Ask Tool** — a governed decision-record primitive for typed user questions.
2. **Todo Tool** — phased task state with stable content identity, statuses, notes, markdown import/export, and completion reminders.
3. **Report Finding Tool** — reviewer-only structured P0-P3 findings with evidence and aggregate verdicts.
4. **Task Tool evolution** — typed parallel batches, structured outputs, policy ceilings, artifact references, and bounded reviewer-to-explore delegation.

The build order for this tranche is Ask Tool, Todo Tool, Report Finding/review flow, then task batching and structured outputs.

## Reasoning

- **Preserves maintainability**: Thanos avoids owning a full agent runtime unless a capability truly requires deeper control.
- **Keeps governance central**: New interaction and workflow features become policy-aware and auditable rather than bypassing existing safety boundaries.
- **Matches the new product ambition**: Thanos can learn from Oh-my-pi's broader distribution model without pretending every useful feature must be governance-only.
- **Controls fork risk**: A formal `configure | extend | wrap | vendor | fork` classification prevents accidental runtime ownership.
- **Starts with leverage**: Governed interaction primitives improve agent decision quality, review quality, spec evidence, and delegation before adding broader runtime power tools.
- **Supports future expansion**: Runtime tools such as eval, LSP, DAP, richer VFS, browser automation, memory, ACP, and commit workflows remain eligible for later tranches under the same extension-first strategy.

## Consequences

- CONTEXT.md must describe Thanos as an Agent Distribution with a governance pillar, not only as a Team-grade Governance Layer.
- Roadmaps should evaluate Oh-my-pi-inspired features through the `configure | extend | wrap | vendor | fork` lens.
- Governance primitives must remain compatible with non-governance productivity features instead of assuming those features are out of scope.
- Governed interaction primitives introduce a separate `interaction` capability so policy does not confuse human/reviewer interaction with subagent delegation.
- Any future vendoring or runtime fork decision should receive explicit trade-off review, and likely a dedicated ADR when it is hard to reverse, surprising, and based on real alternatives.
- The first implementation work should focus on governed interaction primitives before broad runtime power tools or UI polish.
