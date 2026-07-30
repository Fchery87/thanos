# ADR 0020 — Waves uses a parent-owned journaled workflow

**Status:** Accepted

ADR 0010 established that named workflows must be enforced, but left delegated mutation open once the delegation protocol could carry a Run Grant. ADR 0012 consequently allowed explicit worktree-isolated writers. The implemented public V2 boundary, Pi session lifecycle, and single-checkout workflow show that this flexibility creates unreachable writer paths, competing ownership models, and authority-transfer problems without improving the normal Pi workflow.

Waves is therefore a multi-turn, parent-owned Enforced Workflow. Delegated nodes are structurally read-only and `pi-subagents` remains their sole Delegation and Recovery Authority. The main-session Integration Owner alone mutates the target checkout under an operator-approved Integration Contract and process-local Run Grant. SpecEngine remains the operator-task acceptance authority, while Waves exclusively drives continuation only for the duration of its active workflow.

Workflow intent and accepted evidence references are journaled as append-only Pi session entries and reconstructed from the active branch. Run Grants, active delegation, and continuation authority are never persisted or transferred. Reload restores a mutating workflow paused; ordinary session switching, forking, and tree navigation are blocked while it is active. Explicit handoff terminates the source and creates a lineage-linked paused workflow with a new identity in a fresh session.

This decision supersedes ADR 0012's optional parallel-writer path and refines ADR 0010: delegated mutation is no longer a dormant future mode of Waves. The obsolete child-writer fields, scheduling branches, overlap checks, and fail-closed placeholder are removed rather than retained as dead code. Pi owns parent retry, authentication refresh, and compaction; Waves observes those outcomes and does not add a recovery wrapper.
