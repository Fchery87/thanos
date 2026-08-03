# ADR 0021 — One canonical tool/capability contract

**Status:** Accepted

Tool classification (capability, risk tier, recognized/unknown) was computed
once by `src/permissions/risk.ts` and `src/governance/tool-call.ts` for
runtime authorization, and separately re-derived — sometimes incompletely —
everywhere a human needed to see it: `/tools` rebuilt the active-tool list
inline, `docs/governance.md` hand-maintained a static risk/capability table,
and neither agreed with the other. The table was missing `goal_complete` and
`subagent` outright, and `workflow_yield` — a real registered harness tool —
fell through both classifiers' unknown/unrecognized path entirely, because
nothing forced the diagnostic surface and the runtime surface to consume the
same source.

`src/governance/tool-contract.ts` is now that one source: `buildToolContractSnapshot()`
projects the live `pi.getAllTools()`/`pi.getActiveTools()` registry through
the *existing* `capabilityForTool`/`classifyRisk`/`isRecognizedTool` functions
into a read-only snapshot. It is a projection, not a second authorization
engine — it calls the same functions `GovernanceRuntime` calls, it never
re-derives their logic, and nothing it produces is consumed as an
authorization input anywhere. `/tools`, `/doctor`, and `docs/reference.md`'s
drift test all consume this one snapshot now; `docs/governance.md` no longer
carries a hand-maintained table, only a pointer to `/tools` as the live
source.

Future diagnostic or documentation surfaces that need to describe the tool
surface — a future `/tools`-adjacent command, a generated doc, a test —
should consume `buildToolContractSnapshot()` rather than re-deriving
capability/risk/recognized classification independently. A second
independent classification is exactly the drift this ADR closes; it is not a
pattern to repeat for a new consumer.
