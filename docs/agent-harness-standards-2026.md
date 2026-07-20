# Agent Harness Standards and State of the Art, July 13, 2026

## Executive summary

An agent harness is no longer just a model loop plus tools. The credible 2026 baseline is a governed execution system with protocol adapters, scoped identity, policy enforcement before side effects, OS-enforced isolation, durable state, complete traces, reproducible evaluation, and verifiable software provenance.

No single standard covers that whole system. The strongest design composes:

- **MCP 2025-11-25** for model-to-tool/context interoperability.
- **A2A 1.0** for agent discovery, task exchange, streaming, and asynchronous collaboration.
- **OpenTelemetry** for transport and trace infrastructure, while treating its GenAI agent semantic conventions as version-pinned **Development** material.
- **NIST AI RMF 1.0 plus NIST AI 600-1** for the risk-management lifecycle.
- **OWASP Top 10 for Agentic Applications 2026** as the agent-specific threat model.
- **SLSA 1.2 plus Sigstore** for build, release, plugin, skill, MCP-server, and policy-bundle provenance.
- **SPIFFE/SPIRE plus OAuth 2.0 Token Exchange (RFC 8693)** for workload identity and explicit delegated authority.
- **OPA/Rego or Cedar** for deterministic policy decisions outside the model.
- A durable workflow engine and a strong sandbox for reliable, recoverable execution.

The most important architectural rule is: **treat model output, retrieved context, tool metadata, memory, agent messages, and repository instructions as untrusted proposals; only deterministic policy and a real isolation boundary may grant authority.** MCP itself says tool descriptions are untrusted and that hosts must retain user control; vendor systems increasingly implement this with pre-tool hooks, scoped permissions, and OS sandboxes.[MCP-SPEC][CLAUDE-PERM][CODEX-SEC]

## Status vocabulary

This report uses three labels:

- **Ratified/stable**: a released standard, final government publication, stable project specification, or versioned normative release.
- **Experimental/draft**: explicitly marked Development, experimental, preview, beta, release candidate, or an IETF Internet-Draft.
- **Vendor practice**: a production feature or recommendation from one implementation. It may be excellent practice, but it is not an interoperable standard.

"Stable" does not mean complete. MCP authorization, for example, is in a released MCP specification but normatively depends in part on OAuth 2.1 and Client ID Metadata Document drafts.[MCP-AUTH]

## Maturity ledger

| Area | State on 2026-07-13 | What to standardize in a harness |
| --- | --- | --- |
| MCP | **Ratified/released**: dated 2025-11-25 specification | Pin protocol version; capability-negotiate; validate schemas; treat annotations as untrusted; implement consent, resource-bound tokens, PKCE, cancellation, progress, and bounded sampling/tool loops.[MCP-SPEC][MCP-AUTH][MCP-SAMPLING] |
| A2A | **Stable**: Linux Foundation A2A 1.0.0, described as production-ready | Use Agent Cards, signed-card verification, per-interface version negotiation, authenticated extended cards, task lifecycle, artifacts, streaming/push, and standard web security.[A2A-SPEC][A2A-1] |
| OpenTelemetry core | **Stable** project/specification | Use W3C trace context and OTLP as the vendor-neutral telemetry substrate. |
| OTel GenAI/agent semantic conventions | **Development** | Pin a semconv version behind an adapter; do not expose raw prompts/results by default; preserve stable internal event names and map outward.[OTEL-AGENT][OTEL-GENAI] |
| NIST AI RMF / GenAI Profile | **Final, voluntary guidance** | Operate GOVERN, MAP, MEASURE, MANAGE continuously; map controls and evidence to the 12 GenAI risk categories.[NIST-RMF][NIST-GAI] |
| OWASP Agentic Top 10 | **Published community guidance**, not a formal standards-body protocol | Threat-model all ten risks and attach tests/controls to each release.[OWASP-A10] |
| SLSA | **Stable** v1.2 | Produce and verify provenance against trusted builder/source identities and expected parameters; prefer Build L3 controls for distributed harness artifacts.[SLSA-12][SLSA-VERIFY] |
| Sigstore/Cosign | **Stable practice/tooling** | Keyless sign immutable releases and attestations; verify artifact digest, signer identity, issuer, and transparency proof before installation.[SIGSTORE] |
| SPIFFE Workload API | **Stable** | Issue short-lived, audience-bound workload identities from attested runtime identity; avoid static agent secrets.[SPIFFE] |
| OAuth Token Exchange | **IETF Standards Track RFC** | Preserve user (`sub`) and acting agent (`act`) separately; mint audience-, scope-, and time-constrained downstream tokens.[RFC8693] |
| Multi-hop actor-chain profiles and OAuth-SPIFFE client auth | **IETF drafts** | Experiment only behind adapters; do not make interoperability depend on them yet.[ACTOR-DRAFT][SPIFFE-OAUTH-DRAFT] |
| OPA/Rego and Cedar | **Mature policy-as-code practice** | Make authorization an external, deterministic, auditable decision over principal, action, resource, context, and delegation; default deny.[OPA][CEDAR] |
| Durable execution for agents | **Vendor practice**, with mature workflow systems | Persist step state; isolate nondeterminism in retryable activities; use idempotency keys and human signals; never blindly replay side effects.[TEMPORAL] |
| Agent Skills / `AGENTS.md` / vendor subagent manifests | **Emerging cross-vendor convention and vendor practice** | Support progressive disclosure, repository-scoped instructions, explicit capability ceilings, fresh contexts, bounded fan-out, structured results, and worktree isolation.[CODEX-CUSTOM][CLAUDE-SUB][COPILOT-AGENT] |

## 1. Protocol boundaries: MCP and A2A

### MCP is the tool/context plane

MCP 2025-11-25 is a JSON-RPC protocol between hosts, clients, and servers. Servers expose resources, prompts, and tools; clients may expose sampling, roots, and elicitation. It also defines lifecycle negotiation, progress, cancellation, logging, and JSON Schema behavior.[MCP-SPEC]

Harness requirements:

1. **Pin and negotiate.** Record MCP protocol and server implementation versions in every connection and trace. Reject undeclared capabilities.
2. **Validate both directions.** Validate tool inputs and structured outputs against their declared dialect; MCP requires at least JSON Schema 2020-12 support.[MCP-BASIC]
3. **Do not trust discovery metadata.** Names, descriptions, icons, annotations, and schemas inform presentation and validation; they do not confer trust. Bind trust to administrator policy, server identity, provenance, and runtime authorization.[MCP-SPEC]
4. **Separate discovery from enablement.** A discovered tool remains disabled until policy grants the server, tool, data class, and operation.
5. **Apply per-call least privilege.** For HTTP, use protected-resource metadata, resource indicators, PKCE, exact redirect validation, audience-bound tokens, and challenged scopes. Never pass an upstream token through to another server.[MCP-AUTH]
6. **Bound recursion.** Sampling with tools can create nested agent loops. Enforce maximum turns, calls, cost, wall time, recursion depth, and parallelism, and require a result for every tool-use ID.[MCP-SAMPLING]
7. **Consent is a harness responsibility.** MCP expresses strong consent principles but cannot enforce the user interface or policy. The host must make side effects, data disclosure, and sampling visible and revocable.[MCP-SPEC]

### A2A is the agent/task plane

A2A 1.0 is complementary, not competitive. It is designed for independent, opaque agents to discover capabilities and exchange tasks, messages, artifacts, status, and long-running updates without revealing internal memory or tools. Its normative data model is `a2a.proto`; JSON Schema and SDKs are derived artifacts.[A2A-SPEC]

Harness requirements:

1. **Verify Agent Cards before trusting them.** A2A 1.0 supports RFC 8785 canonicalization and JWS-signed Agent Cards. Verify signatures against configured trust roots and bind the verified card version to the session.[A2A-NEW]
2. **Keep public discovery minimal.** Use authenticated extended cards for sensitive skills, endpoints, or configuration.
3. **Negotiate per interface.** Select a declared JSON-RPC, gRPC, or HTTP interface and compatible major/minor version; do not infer support.
4. **Authorize each skill/task.** Authentication of an agent is not authorization to every skill or resource. Evaluate local policy using the calling workload, represented user, requested skill, task context, and data classification.
5. **Make tasks durable and cancellable.** Preserve task IDs, context IDs, status transitions, artifacts, deduplication keys, deadlines, and cancellation.
6. **Authenticate callbacks.** Push-notification endpoints need authenticated registration, SSRF controls, replay protection, and signed or mutually authenticated delivery.
7. **Treat remote output as untrusted input.** Scan artifacts and messages before placing them in model context, memory, a shell, or a downstream request.

## 2. Observability and evidence

### OpenTelemetry

Use standard OpenTelemetry traces, metrics, logs, baggage, W3C trace context, and OTLP. The GenAI agent conventions are valuable but explicitly marked **Development**. Current source defines operations including agent creation/invocation, workflows/planning, and tool execution, with `gen_ai.*` attributes; the exact vocabulary can change.[OTEL-AGENT]

Implementation pattern:

- Maintain a versioned internal event contract and an OTel mapping module.
- Pin the emitted GenAI semconv version and test exact exported attributes.
- Propagate trace context across MCP, A2A, subagents, durable activities, policy checks, and sandbox commands.
- Give every model call, tool proposal, policy decision, approval, execution, handoff, memory read/write, checkpoint, retry, and artifact a span or linked event.
- Record model/provider/version, agent/policy/config versions, tool and server identities, token counts, latency, retries, cost, sandbox identity, and outcome.
- Store hashes or protected references for prompts, outputs, files, and artifacts. OpenTelemetry recommends not capturing GenAI content by default and suggests external storage with separate access controls for production.[OTEL-GENAI]
- Link audit decisions to traces with stable decision IDs, but keep audit retention and tamper controls independent of the tracing backend.

### Trace grading and evals

Final-answer grading is insufficient for agents. OpenAI defines trace grading as structured scoring of the end-to-end decisions and tool calls; Google ADK separately evaluates exact/in-order/any-order tool trajectories and rubric-based tool quality.[OPENAI-TRACE-GRADE][ADK-EVAL]

A serious harness evaluates four layers:

1. **Outcome:** tests pass, requested state exists, no forbidden state changed.
2. **Trajectory:** required tools and approvals occurred in a valid order; forbidden calls, retries, and loops did not occur.
3. **Policy/safety:** every side effect had an allow decision or approval, sensitive reads were blocked, delegated authority remained scoped, and attacks did not escape containment.
4. **Efficiency/reliability:** latency, tokens, cost, tool count, retries, recovery time, and human interruptions remain within budgets.

Prefer deterministic graders first: exit status, state diff, schema, exact tool/argument checks, policy decisions, provenance verification, and security invariants. Use model graders for semantic quality and flexible trajectories; calibrate them against expert labels, sample multiple judgments where needed, and test for grader/reward hacking.[OPENAI-EVAL][ADK-EVAL]

## 3. Governance and threats

### NIST AI RMF GenAI Profile

NIST AI 600-1 is a final cross-sectoral, voluntary companion to AI RMF 1.0. Apply its GOVERN, MAP, MEASURE, and MANAGE functions throughout the harness lifecycle, not as a release checklist.[NIST-GAI][NIST-RMF]

For agent harnesses, the profile translates into:

- Inventory models, tools, MCP/A2A peers, identities, memory stores, policies, sandboxes, datasets, and suppliers.
- Document intended uses, prohibited uses, autonomy boundaries, affected users, knowledge limits, human oversight, and shutdown/recovery paths.
- Measure confabulation, information security, privacy, provenance, harmful content/bias, human reliance, and component/value-chain risk.
- Assign risk owners and tolerances; continuously monitor and respond to incidents and emergent risks.
- Preserve versioned evidence for independent review: risk mapping, tests, red-team cases, approvals, incidents, model/policy changes, and residual-risk acceptance.

### OWASP Top 10 for Agentic Applications 2026

OWASP's 2026 list is a peer-reviewed community threat baseline, not a ratified protocol. It identifies:[OWASP-A10][OWASP-LIST]

1. ASI01 Agent Goal Hijack
2. ASI02 Tool Misuse and Exploitation
3. ASI03 Identity and Privilege Abuse
4. ASI04 Agentic Supply Chain Vulnerabilities
5. ASI05 Unexpected Code Execution
6. ASI06 Memory and Context Poisoning
7. ASI07 Insecure Inter-Agent Communication
8. ASI08 Cascading Failures
9. ASI09 Human-Agent Trust Exploitation
10. ASI10 Rogue Agents

Every harness release should maintain threat-to-control-to-test mappings for all ten. Key controls are source/data provenance, instruction/data separation, taint labels, least privilege, short-lived delegation, deterministic pre-action policy, sandboxing, egress control, signed peers/artifacts, bounded execution, circuit breakers, independent verification, reversible changes, and incident kill switches.

## 4. Identity, delegation, and authorization

Use separate identities for:

- the requesting human or service,
- the harness/workload,
- each subagent or remote agent role,
- the authorization/policy decision,
- the target resource.

SPIFFE's stable Workload API delivers short-lived X.509-SVID and JWT-SVID identities based on out-of-band workload attestation. JWT-SVIDs are audience-bound; trust bundles support federation. SPIRE is the production implementation.[SPIFFE][SPIRE]

RFC 8693 is the stable delegation primitive. A `subject_token` identifies the party represented, an `actor_token` identifies the acting party, and the issued token may carry `sub` plus `act`. Delegation preserves both identities; impersonation does not.[RFC8693]

Recommended flow:

1. Attest the running harness/subagent and obtain a short-lived workload identity.
2. At a policy decision point, exchange the user's grant and agent identity for a new token.
3. Restrict it to one audience/resource, operation scope, tenant, task, short lifetime, and ideally proof-of-possession.
4. Log subject, actor, issuer, audience, scopes, task, policy decision, and token hash, never the token.
5. Re-exchange at each boundary rather than forwarding bearer credentials.
6. Revoke or let credentials expire when the task ends; do not place credentials in model context, shell environment, repository, trace content, or memory.

Nested `act` can express a history, but RFC 8693 does not fully standardize multi-hop chain continuity. The actor-chain and OAuth-SPIFFE work available in 2026 remains draft; treat it as an experiment and preserve a separate signed audit chain.[ACTOR-DRAFT][SPIFFE-OAUTH-DRAFT]

## 5. Policy as code

Prompts are guidance, not enforcement. Put durable authorization in a policy decision point invoked before every governed action and after material context changes.

OPA is a graduated CNCF policy engine that separates policy decision from enforcement and supports Rego, bundles, local/sidecar evaluation, decision logs, and WebAssembly embedding.[OPA] Cedar models principal-action-resource-context, defaults to deny, and gives `forbid` precedence over `permit`; its schema supports policy validation.[CEDAR]

The normalized decision input should include:

- subject and actor identity/delegation chain,
- agent role/version and parent task,
- tool/server identity and verified provenance,
- normalized action and arguments,
- canonical resource paths/URLs and resolved destinations,
- risk tier, data classification, taint/provenance, and side-effect class,
- sandbox and network posture,
- interactive/headless mode, approval history, budgets, and time.

The output should be structured: `allow | deny | require_approval`, matched rule IDs, obligations, redactions, resource limits, approval scope, expiry, and safe explanation. Default deny unknown actions, malformed inputs, unavailable policy, and headless interactions requiring a person. Version, test, sign, distribute, and audit policy bundles like code. Redact sensitive fields from decision logs.

## 6. Sandboxing and side-effect control

The leading vendor guidance is consistent: permissions decide whether an action may run; the sandbox constrains what it can do after it runs. Both are required.[CLAUDE-SANDBOX][CODEX-SANDBOX]

Baseline:

- Use an ephemeral workspace or isolated git worktree per writing agent.
- For untrusted code or unattended execution, isolate the whole harness, including hooks and MCP servers, in a container, gVisor/microVM, or VM; a shell-only sandbox is not enough.[CLAUDE-ENV]
- Default filesystem to read-only; grant narrowly scoped writable roots and ephemeral scratch.
- Deny access to credentials and host sockets; strip environment variables.
- Default network deny; egress only through an authenticated proxy with DNS/IP rebinding defenses, destination policy, traffic logging, and credential injection outside the sandbox.
- Run non-root; drop capabilities; set `no_new_privileges`, seccomp, process, CPU, memory, disk, and wall-time limits.
- Separate model calls from tool execution. Validate canonical arguments before dispatch.
- Use overlays/snapshots so changes can be reviewed, diffed, committed, or discarded.
- Block self-modification of harness policy, hooks, agent definitions, audit, and updater unless an explicitly authorized maintenance workflow is active.
- Fail closed if a required sandbox cannot initialize. Anthropic explicitly offers a `failIfUnavailable` control; this behavior should be universal.[CLAUDE-SANDBOX]

## 7. Durable execution and recovery

Agent runs are distributed workflows: model calls time out, workers crash, users pause for hours, tools rate-limit, and side effects may be ambiguous. Temporal's official agent examples put LLM and tool calls in Activities, persist their results in workflow history, and replay workflow logic without re-executing completed calls.[TEMPORAL]

Required semantics:

- Durable run, turn, task, tool-call, approval, artifact, and checkpoint IDs.
- Explicit state machine with terminal states, cancellation, deadlines, pause/resume, and human signals.
- Nondeterministic calls outside replayed workflow logic.
- Idempotency keys and effect receipts for every mutation.
- Retry classification: safe retry, verify-before-retry, compensate, or human intervention.
- Never retry an unknown-outcome side effect merely because the client timed out.
- Deterministic replay tied to exact model, prompt/config, policy, tool schema, and code versions where possible; otherwise resume from a checkpoint rather than pretending replay is deterministic.
- Bounded histories with compaction or claim-check storage for large content, preserving hashes and references.
- Durable sandbox lifecycle: provision, snapshot/suspend, restore, and guaranteed cleanup.[TEMPORAL-SANDBOX]

## 8. Context and memory

Google ADK usefully distinguishes **Session** (one conversation/event history), **State** (data for that session), and **Memory** (searchable cross-session knowledge).[ADK-SESSION] OpenAI sessions similarly manage conversation history and support bounded retrieval, compaction, encrypted wrappers, and multiple backends.[OPENAI-SESSION]

Harness rules:

- Keep instructions, immutable evidence, current task state, user conversation, retrieved context, and long-term memory as distinct stores/types.
- Attach origin, author, timestamp, tenant, sensitivity, trust/taint, TTL, version, and integrity hash to every memory item.
- Require policy for memory reads and writes; partition by tenant, user, project, and agent role.
- Sanitize and validate before persistence. Remote tool/agent output must not become durable instruction by default.
- Support user inspection, correction, deletion, retention, and export.
- Retrieve minimally, cite sources, and record retrieval IDs/scores in traces.
- Detect poisoning through provenance filters, contradiction checks, canary evals, write review for high-trust memory, and rollback.
- Use progressive disclosure: concise project instructions at startup; load skills, references, and deep memory only when relevant.
- Treat repository instruction files and auto-memory as context, not policy. Anthropic explicitly states that `CLAUDE.md` and auto memory are not enforced controls.[CLAUDE-MEM]

## 9. Vendor implementation lessons

These are **vendor practices**, not standards.

### OpenAI Agents SDK and Codex

- Agents SDK traces model generations, tool calls, handoffs, guardrails, and custom events; it supports alternate trace processors and sensitive-data exclusion.[OPENAI-TRACE]
- Input/output guardrails have workflow-boundary semantics; tool guardrails are needed for each custom function call. Parallel guardrails can allow work or side effects to begin before a failure, so blocking mode is required for precondition/security checks.[OPENAI-GUARD]
- Handoffs support structured inputs, dynamic enablement, and input filters; by default the next agent can receive the full history, so minimize transfer context.[OPENAI-HANDOFF]
- Codex combines `AGENTS.md`, skills, MCP, memories, subagents, OS sandboxing, approval policy, structured JSONL automation, output schemas, and automatic review. Auto-review remains probabilistic and does not replace the sandbox.[CODEX-CUSTOM][CODEX-SEC][CODEX-AUTO]

### Anthropic Claude Code / Agent SDK

- Custom subagents have fresh contexts, focused prompts, tool restrictions, model choice, turn limits, optional memory, hooks, background execution, and worktree isolation. Forked contexts are explicitly less isolated.[CLAUDE-SUB]
- Permission rules are enforced by the runtime, not the model, with deny-before-ask-before-allow behavior and managed settings.[CLAUDE-PERM]
- The Bash sandbox uses Seatbelt or bubblewrap plus network proxying. Anthropic warns that it covers Bash children, not all host-running tools/hooks/MCP servers; whole-process containers/VMs are recommended for unattended work.[CLAUDE-SANDBOX][CLAUDE-ENV]
- Persistent instructions and auto-memory are contextual guidance. Pre-tool hooks or permissions enforce rules.[CLAUDE-MEM]

### Google ADK and Gemini CLI

- ADK composes deterministic nodes and agents as graph, dynamic, collaborative, sequential, loop, and parallel workflows; it separates session/state/memory and provides logging, metrics, traces, and trajectory evaluation.[ADK-MULTI][ADK-SESSION][ADK-OBS][ADK-EVAL]
- Agent routing is explicitly experimental.[ADK-MULTI]
- Gemini CLI exposes policy rules (`allow`, `deny`, `ask_user`), admin precedence, headless ask-as-deny behavior, MCP-specific policies, subagent-specific rules, hooks, sandboxing, and sandbox expansion. Its subagents and parts of tool sandboxing are marked preview/experimental in source docs.[GEMINI-POLICY][GEMINI-SANDBOX]

### GitHub Copilot coding agent / SDK

- Current practice includes custom agents with scoped tools/MCP, isolated subagent contexts, lifecycle events, fleet/parallel patterns, repository hooks, ephemeral cloud sandboxes, constrained egress, self-review, and security scanning.[COPILOT-AGENT][COPILOT-HOOKS][COPILOT-2026]
- Pre-tool hooks can enforce permissions and audit. GitHub documents an important failure semantic: command pre-tool hooks fail closed, while HTTP pre-tool hooks can fail open on transport errors. Security-critical policy should therefore be local or use an explicitly fail-closed client.[COPILOT-HOOKS]

## 10. Supply-chain integrity

Apply SLSA/Sigstore to the harness binary/package, container, installer, MCP servers, plugins/extensions, agent/skill bundles, policy bundles, sandbox images, and evaluation datasets.

Minimum release gate:

1. Build in an isolated, hosted, ephemeral builder with non-falsifiable provenance; target SLSA Build L3 for distributed artifacts.[SLSA-12]
2. Emit in-toto/SLSA provenance and SBOM; include canonical source, commit/tag, builder identity, build type, external parameters, and dependencies.
3. Sign immutable digests with Sigstore keyless signing or protected organizational keys.
4. Publish verification bundles/transparency evidence alongside releases.
5. At install/update/load time, verify digest subject, signature, Fulcio/PKI chain, expected OIDC issuer and exact workflow/repository identity, Rekor inclusion, canonical source, tag/ref, builder, build type, and allowed parameters.[SLSA-VERIFY][SIGSTORE]
6. Pin by digest or immutable release; never execute branch-tip payloads or unverified remote install scripts.
7. Generate an allowlisted component manifest and reject unrecognized plugins, tools, schemas, policies, or model endpoints.
8. Make rollback, revocation, compromised-version denylisting, and transparency-log monitoring operational.

Signatures alone prove who signed bytes, not that the bytes are safe. SLSA provenance plus verifier expectations connects an artifact to an approved source and build process.[SLSA-VERIFY]

## 11. Reference harness architecture

1. **Ingress and contract**: authenticate requester; normalize intent; establish task, risk, budgets, and acceptance criteria.
2. **Context broker**: resolve repository instructions, skills, memory, and retrieval with provenance, taint, redaction, and token budgets.
3. **Planner/orchestrator**: produce bounded typed steps; use deterministic workflows where order is known; delegate only narrow tasks.
4. **Identity broker**: issue workload identity and per-resource delegated tokens.
5. **Policy decision point**: evaluate every tool, MCP/A2A call, context disclosure, memory mutation, delegation, and approval.
6. **Approval service**: show normalized action, target, data, side effect, provenance, policy rule, and duration; support once/session/task scopes and headless fail-closed behavior.
7. **Execution broker**: dispatch only validated actions into a sandbox; inject credentials out of band; collect effect receipts.
8. **Protocol gateways**: pin MCP/A2A versions, verify peer identity/provenance, schema-validate, apply rate/cost/recursion limits, and translate protocol events to the internal contract.
9. **Durable state**: persist workflow state, idempotency, checkpoints, artifacts, approvals, cancellation, and compensation.
10. **Evidence plane**: emit OTel traces and immutable audit records with safe references; preserve policy, model, prompt, tool, code, and dataset versions.
11. **Verification gate**: run tests, security checks, policy assertions, provenance checks, deterministic trajectory graders, and calibrated semantic graders before delivery.
12. **Delivery/recovery**: present diffs and evidence, require approval for irreversible release actions, support rollback, revoke credentials, and destroy sandboxes.

## 12. Top benchmark criteria

Use a weighted benchmark with hard safety gates. A harness that fails any gate cannot be called production-grade regardless of aggregate score.

| Weight | Criterion | Evidence |
| ---: | --- | --- |
| 15 | **Policy enforcement and fail-closed behavior** | Deterministic pre-action decisions; default deny; stable rule IDs; headless denial; policy outage and malformed-input tests; no model-only enforcement. |
| 15 | **Sandbox containment and secret isolation** | Filesystem/network/process escape suite; unavailable-sandbox hard failure; credential non-exposure; no host socket; resource limits; whole-process isolation for unattended work. |
| 12 | **Identity and least-privilege delegation** | Attested workload identity; separate subject/actor; audience/scope/task/time-bound tokens; no token forwarding; revocation and confused-deputy tests. |
| 10 | **Traceability and audit completeness** | End-to-end trace correlation across model/tool/policy/approval/subagent/MCP/A2A/durable steps; immutable, redacted audit; exact component versions and artifact hashes. |
| 10 | **Evaluation quality and regression control** | Representative datasets; deterministic outcome and trajectory checks; adversarial OWASP cases; calibrated model graders; repeated trials; confidence intervals; release thresholds. |
| 8 | **Durability and side-effect correctness** | Crash/restart, timeout, duplicate delivery, cancellation, pause/resume, unknown-outcome, idempotency, compensation, and sandbox restoration tests. |
| 8 | **Supply-chain provenance** | SLSA provenance, SBOM, signed immutable artifacts, expected-identity verification, transparency evidence, dependency/plugin/policy verification, rollback/revocation. |
| 7 | **Protocol conformance and interoperability** | Version-pinned MCP/A2A conformance, capability negotiation, schema validation, cancellation/progress, signed Agent Cards, token audience checks, malformed-peer tests. |
| 5 | **Context and memory integrity** | Provenance/taint/TTL/tenant metadata; minimal retrieval; poisoning tests; inspected/deletable memory; separation of instructions, state, evidence, and memory. |
| 4 | **Bounded orchestration** | Capability ceilings, fresh-context defaults, structured handoffs/results, recursion/concurrency/turn/cost limits, cancellation, isolated writer workspaces. |
| 3 | **Human control and recoverability** | Comprehensible approvals, narrow grants, preview/diff, undo/rollback, kill switch, incident workflow, no deceptive trust cues. |
| 3 | **Efficiency and operability** | Task success per cost/latency, cache correctness, tool-call economy, observability overhead, degraded-mode behavior, SLOs and capacity limits. |

Hard gates:

- No side effect without a policy decision and, where required, an explicit approval.
- No unattended arbitrary execution outside an enforced isolation boundary.
- No long-lived or cross-resource credential exposed to model context or sandbox.
- No install/update of unverified executable components.
- No release without reproducible evaluation evidence and an attributable audit trail.
- No cross-tenant context, memory, artifact, trace-content, or credential leakage in adversarial tests.

## 13. Recommended adoption sequence

1. Normalize tool/agent actions and implement fail-closed policy plus audit IDs.
2. Put all execution behind a sandbox and credential-injecting egress broker.
3. Add SPIFFE workload identity and RFC 8693-style scoped delegation.
4. Implement MCP with strict versioning, authorization, schema validation, and consent; add A2A only for genuine remote-agent boundaries.
5. Add durable state, idempotency, cancellation, and effect receipts.
6. Instrument an internal trace contract and map it to a pinned OTel GenAI version.
7. Build deterministic outcome, policy, security, trajectory, and recovery evals; add calibrated model graders last.
8. Sign and verify every distributed component and policy bundle with SLSA/Sigstore evidence.
9. Add scoped subagents, memory, background work, and automatic reviewers only after the governance spine is measurable.

## Sources

Primary and first-party sources were favored. Status statements are as of **2026-07-13**.

- **[MCP-SPEC]** Model Context Protocol, "Specification 2025-11-25," https://modelcontextprotocol.io/specification/2025-11-25/index
- **[MCP-BASIC]** Model Context Protocol, "Basic Protocol," https://modelcontextprotocol.io/specification/2025-11-25/basic
- **[MCP-AUTH]** Model Context Protocol, "Authorization," https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- **[MCP-SAMPLING]** Model Context Protocol, "Sampling," https://modelcontextprotocol.io/specification/2025-11-25/client/sampling
- **[A2A-SPEC]** Linux Foundation A2A, "Agent2Agent Protocol Specification 1.0.0," https://a2a-protocol.org/v1.0.0/specification/
- **[A2A-1]** Linux Foundation A2A, "Announcing Version 1.0," https://a2a-protocol.org/latest/announcing-1.0/
- **[A2A-NEW]** Linux Foundation A2A, "What's New in v1.0," https://a2a-protocol.org/latest/whats-new-v1/
- **[OTEL-AGENT]** OpenTelemetry, "Semantic Conventions for GenAI agent and framework spans," https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md
- **[OTEL-GENAI]** OpenTelemetry, "Semantic Conventions for generative client AI spans," https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md
- **[NIST-RMF]** NIST, "Artificial Intelligence Risk Management Framework (AI RMF 1.0)," https://doi.org/10.6028/NIST.AI.100-1
- **[NIST-GAI]** NIST, "Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile," NIST AI 600-1, https://doi.org/10.6028/NIST.AI.600-1
- **[OWASP-A10]** OWASP GenAI Security Project, "OWASP Top 10 for Agentic Applications for 2026," https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/
- **[OWASP-LIST]** OWASP GenAI Security Project, release discussion naming ASI01-ASI10, https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/
- **[SLSA-12]** SLSA, "SLSA Specification v1.2," https://slsa.dev/spec/v1.2/
- **[SLSA-VERIFY]** SLSA, "Build: Verifying artifacts," https://slsa.dev/spec/v1.2/verifying-artifacts
- **[SIGSTORE]** Sigstore, "Verifying Signatures," https://docs.sigstore.dev/cosign/verifying/verify/
- **[SPIFFE]** SPIFFE, "SPIFFE Workload API," stable specification, https://spiffe.io/docs/latest/spiffe-specs/spiffe_workload_api/
- **[SPIRE]** SPIFFE, "SPIRE Concepts," https://spiffe.io/docs/latest/spire-about/spire-concepts/
- **[RFC8693]** IETF, RFC 8693, "OAuth 2.0 Token Exchange," https://www.rfc-editor.org/rfc/rfc8693
- **[ACTOR-DRAFT]** IETF Datatracker, "Actor Chain Profiles for OAuth 2.0 Token Exchange," Internet-Draft, https://datatracker.ietf.org/doc/draft-mw-spice-actor-chain/
- **[SPIFFE-OAUTH-DRAFT]** IETF Datatracker, "OAuth SPIFFE Client Authentication," Internet-Draft, https://datatracker.ietf.org/doc/draft-ietf-oauth-spiffe-client-auth/
- **[OPA]** Open Policy Agent, official documentation, https://www.openpolicyagent.org/docs/latest/
- **[CEDAR]** Cedar, "How Cedar authorization works," https://docs.cedarpolicy.com/auth/authorization.html
- **[TEMPORAL]** Temporal, "How To Build a Durable AI Agent with Temporal and Python," https://learn.temporal.io/tutorials/ai/durable-ai-agent/
- **[TEMPORAL-SANDBOX]** Temporal, "Temporal Sandbox Orchestration Harness," https://temporal.io/blog/temporal-sandbox-orchestration-harness-the-missing-layer-for-running-agents
- **[OPENAI-TRACE]** OpenAI Agents SDK, "Tracing," https://openai.github.io/openai-agents-python/tracing/
- **[OPENAI-GUARD]** OpenAI Agents SDK, "Guardrails," https://openai.github.io/openai-agents-python/guardrails/
- **[OPENAI-HANDOFF]** OpenAI Agents SDK, "Handoffs," https://openai.github.io/openai-agents-python/handoffs/
- **[OPENAI-SESSION]** OpenAI Agents SDK, "Sessions," https://openai.github.io/openai-agents-python/sessions/
- **[OPENAI-TRACE-GRADE]** OpenAI, "Trace grading," https://developers.openai.com/api/docs/guides/trace-grading
- **[OPENAI-EVAL]** OpenAI, "Evaluation best practices," https://developers.openai.com/api/docs/guides/evaluation-best-practices
- **[CODEX-CUSTOM]** OpenAI Codex, "Customization," https://developers.openai.com/codex/concepts/customization
- **[CODEX-SEC]** OpenAI Codex, "Agent approvals & security," https://developers.openai.com/codex/agent-approvals-security
- **[CODEX-SANDBOX]** OpenAI Codex, "Sandbox," https://developers.openai.com/codex/concepts/sandboxing
- **[CODEX-AUTO]** OpenAI Codex, "Auto-review," https://developers.openai.com/codex/concepts/sandboxing/auto-review
- **[CLAUDE-SUB]** Anthropic, "Create custom subagents," https://code.claude.com/docs/en/subagents
- **[CLAUDE-PERM]** Anthropic, "Configure permissions," https://code.claude.com/docs/en/permissions
- **[CLAUDE-SANDBOX]** Anthropic, "Configure the sandboxed Bash tool," https://code.claude.com/docs/en/sandboxing
- **[CLAUDE-ENV]** Anthropic, "Choose a sandbox environment," https://code.claude.com/docs/en/sandbox-environments
- **[CLAUDE-MEM]** Anthropic, "How Claude remembers your project," https://code.claude.com/docs/en/memory
- **[ADK-MULTI]** Google ADK, "Workflows: multi-agent, multi-node applications," https://google.github.io/adk-docs/agents/multi-agents/
- **[ADK-SESSION]** Google ADK, "Conversational Context: Session, State, and Memory," https://google.github.io/adk-docs/sessions/
- **[ADK-OBS]** Google ADK, "Observability for agents," https://google.github.io/adk-docs/observability/
- **[ADK-EVAL]** Google ADK, "Evaluation Criteria," https://adk.dev/evaluate/criteria/
- **[GEMINI-POLICY]** Google Gemini CLI, "Policy engine," https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md
- **[GEMINI-SANDBOX]** Google Gemini CLI, "Sandboxing," https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md
- **[COPILOT-AGENT]** GitHub Copilot SDK, "Custom agents and sub-agent orchestration," https://github.com/github/copilot-sdk/blob/main/docs/features/custom-agents.md
- **[COPILOT-HOOKS]** GitHub, "GitHub Copilot hooks reference," https://docs.github.com/en/copilot/reference/hooks-configuration
- **[COPILOT-2026]** GitHub, "What's new with GitHub Copilot coding agent," https://github.blog/ai-and-ml/github-copilot/whats-new-with-github-copilot-coding-agent/
