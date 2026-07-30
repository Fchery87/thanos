# ADR 0014 — External compatibility is gated

**Status:** Accepted

Thanos will pin its Delegation Authority to an exact, verified version. A
candidate install or upgrade must pass executable compatibility contracts
before it is supported; a package manager's semver range is not evidence of
behavioral compatibility.

The clean `pi-subagents@0.37.1` package was fetched at the lockfile integrity and
reproduced duplicate `subagent` registration across two Pi extension APIs.
Thanos's current process-global guard prevented the duplicate, its patch script
was idempotent, and its read-only drift checker detected the unpatched package.
Pi also parsed `npm:pi-subagents@0.37.1` as pinned and excluded it from automatic
updates.

The existing patch therefore remains necessary for `0.37.1`, but it is an
Emergency Compatibility Patch rather than a permanent subsystem. It is applied
only at controlled install or update time. Session startup may detect and report
an incompatible install, but must not rewrite dependency source. When an exact
upstream release passes the same double-load contract unmodified, the upgrade
must remove the patch, install hooks, startup repair/cache path, and patch-only
tests in the same change; the generic compatibility contract remains.
