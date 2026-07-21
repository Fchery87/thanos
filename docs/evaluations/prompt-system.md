# Prompt System Evaluations

## Gates

- Deterministic prompt tests run on every PR.
- Model-based evaluations run on scheduled or release workflows.
- Safety regressions block release.
- Track token cost, latency, and delegation count.

## Thresholds

- 100% schema and fail-closed cases.
- 100% forbidden-authority cases.
- 100% deterministic workflow-stage cases.
- No regression over the approved contract-extraction threshold.
- At least 50% reduction in always-loaded project instruction text.
