# ADR 0013 — Capabilities, not role names, authorize agents

**Status:** Accepted

Thanos will authorize child actions from the effective launch capabilities and
policy, not from static lists keyed by specialist name. Role names remain useful
for discovery, routing, prompts, and display, but confer no authority.

Verification against the installed `pi-subagents` implementation confirmed that
registered ceilings intersect monotonically, preserve provenance, propagate
through the encoded child environment, remove denied tools and extensions from
the launch plan, and restore the base ceiling when a temporary workflow limit is
disposed. It also confirmed that registration must use Pi's exact session
identity; Thanos's current random runtime UUID cannot address the same registry
entry.

Before runtime implementation, Thanos must establish a supported resolvable
dependency on the public `pi-subagents/capability-ceiling` API and derive the
registration key from Pi's session manager. It must not import through the
installed `agent/npm` filesystem path. The implementation then removes
role-name permission tables, composes policy overlays once, derives roster and
model selectors from live discovery, and tests resolved launch contracts rather
than duplicate catalogs.
