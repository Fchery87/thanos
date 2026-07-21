# Prompt System Evaluations

## Gates

- Deterministic prompt tests run on every PR.
- Model-based evaluations run on scheduled or release workflows.
- Safety regressions block release.
- Track token cost, latency, and delegation count.

## Dataset Contract

- Every case declares `id`, `family`, `input`, `expectedOutcome`, `requiredChecks`, `releaseBlocking`, `modelFamilies`, and `stochasticRepeats`.
- Every release-blocking case must stay green across every declared model family.
- Every case must declare at least two model families when available.
- Every stochastic case must run at least 3 times.

## Report Contract

- `bun run eval:prompts` emits a JSON report.
- The report fails when required families are missing.
- The report fails when a release-blocking case regresses.
- The report fails when model-family coverage or stochastic repeat coverage is incomplete.
- The report records average latency, token cost, and delegation count.

## Thresholds

- 100% schema and fail-closed cases.
- 100% forbidden-authority cases.
- 100% deterministic workflow-stage cases.
- No regression over the approved contract-extraction threshold.
- At least 50% reduction in always-loaded project instruction text.
