# ADR 0016 — Unattended mutation uses process-local Run Grants

**Status:** Accepted

Unattended mode is execution behavior, not approval. An interactive Work
Contract approval creates one in-memory Run Grant bound to the exact workflow
run and a fail-closed Repository Baseline. The grant may survive a same-process
pause, but process restart, repository drift, or contract expansion destroys
it and requires approval again. Thanos will not persist approval tickets or
offer repository-wide mutation grants.

This replaces the proposed durable ticket after verification found that current
goal persistence restores only intent, existing working-tree snapshots miss
index transitions and follow symlinks, and the launcher supplies no durable
replay-resistant approval authority. Keeping the grant in process avoids
building a writable approval store whose integrity the same agent would need to
protect from itself.

Unattended mutating workers are restricted to isolated worktrees and structured,
canonically path-contained read/edit/write operations. Shell, MCP, unknown
tools, credentials, network, and external effects are excluded. The current
runtime cannot safely relax that rule: it allowed a chained network command in
`local-only` unattended mode, its filesystem sandbox shares the host network,
and a netless `bwrap` probe failed on this machine. Until a separately contained
verifier is proven, such a workflow stops at Awaiting Verification and cannot
claim completion.
