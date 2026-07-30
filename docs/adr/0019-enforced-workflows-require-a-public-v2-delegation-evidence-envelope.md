# ADR 0019 — Enforced workflows require a public V2 delegation evidence envelope

**Status:** Accepted

Thanos will not build Enforced Workflows on `pi-subagents` V1, private runtime
modules, or a hybrid of V1 evidence and V2 identity. Its DelegationRuntime will
consume one public V2 response that binds `ownerRunId`, `nodeId`, `requestId`,
`runId`, the executed `launchContractDigest`, execution, acceptance, review,
effects, artifact references and digests, usage, warnings, and residual risks.
V2 requests must be able to request acceptance.

Executable inspection of the installed `pi-subagents@0.37.1` adapter and the
current upstream `main` package (`0.37.2`) confirmed the same contract gap. V1
can request and return acceptance evidence but lacks workflow-node identity and
the executed launch-contract digest. V2 carries identity and the digest, but its
adapter forces `acceptance: false`, and its terminal response omits execution,
acceptance, review, effects, artifact evidence, warnings, and residual risks.

The public V2 envelope is therefore a compatibility prerequisite, not a second
Thanos executor. Thanos pins `pi-subagents@0.37.2` and applies a bounded Emergency
Compatibility Patch at install/update boundaries. The same executable
compatibility gate imports the patched public adapter and proves acceptance,
identity, execution, review, effects, artifacts, warnings, and residual risks
before an Enforced Workflow is considered available. Missing fields, identity
mismatch, or digest mismatch produces `awaiting_evidence`; it never degrades to
`completed`.

The patch is not a permanent feature. Thanos must delete it as soon as an exact
upstream release passes the same compatibility suite unmodified. Session startup
only reports marker drift; it does not mutate installed dependencies.
