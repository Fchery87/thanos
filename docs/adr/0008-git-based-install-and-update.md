# ADR 0008 — Git-based install and update on all platforms

**Status:** Accepted
**Supersedes:** [ADR 0002](0002-verified-release-bootstrap-installs.md)

## Context

ADR 0002 moved Linux/macOS bootstrap installs to SHA256-verified GitHub release
tarballs, while the Windows installer remained git-clone based. In practice the split
broke the product promise:

1. **`thanos update` was broken on Linux/macOS.** The tarball path refused to run when
   `~/.pi` already existed (the normal state after any install), and the only escape
   hatch (`--force`) moved the entire directory — including the user's `auth.json`,
   `models.json`, and sessions — into a backup, leaving a fresh install with blank
   templates.
2. **Tarball installs have no `.git`**, so no in-place update strategy exists for them
   short of re-implementing sync/overlay logic that git already provides.
3. **Two distribution models meant double maintenance** and platform-specific bugs
   (the Windows installer had silently drifted, missing the pi-subagents patch step).

The user-state problem is structural: Pi requires `~/.pi` to be both the distributed
config layer *and* the home of user-owned files. Git handles exactly this split —
tracked files belong to the distribution, gitignored files belong to the user, and
`checkout`/`reset` never touch ignored files.

## Decision

Both installers (`scripts/install.sh`, `scripts/install.ps1`) use the same git-based
model:

- **Fresh install:** `git clone`, then check out the **latest release tag**
  (highest `v*` by version sort). Explicit `--ref`/`-Ref` (or `THANOS_REF`) overrides,
  including branches for development.
- **Update (`thanos update` or re-running the installer):** if the target directory is
  already a Thanos checkout (origin matches the repo URL), `fetch --tags` and check out
  the latest release tag. User-owned gitignored files are never touched.
- **Collision:** an existing non-Thanos directory aborts the install unless
  `--force`/`-Force` explicitly backs it up.
- Release integrity comes from **tag pinning over HTTPS to GitHub** rather than
  detached SHA256SUMS. The release workflow still runs the full CI gate before a tag
  becomes a release.
- **Bootstrap script trust (accepted tradeoff):** the documented one-liner fetches
  `scripts/install.sh`/`install.ps1` from the `master` tip, while the *payload* it
  installs is tag-pinned. This is the same shape as bun/rustup bootstrap installs:
  the mutable surface is the small bootstrap script, not the installed code. Users
  who want a fully immutable chain fetch the installer itself from a release tag
  (documented in `docs/install.md`). ADR 0002's "no mutable branch-tip installs"
  concern applied to installing *payload* from branch tips, which this model does
  not do.

`tests/scripts/install.test.ts` exercises the flow against local git origins: fresh
install resolves the latest tag, update advances to a new tag while preserving
user-edited `models.json` and `auth.json`, pinned refs work, and non-Thanos
directories are refused.

## Consequences

- `thanos update` works identically on Linux, macOS, and Windows, and can never
  destroy user credentials or settings.
- Installs default to release tags, not branch tips — the mutable-branch trust concern
  from ADR 0002 remains addressed; only the verification mechanism changed
  (tag pinning instead of checksummed tarballs).
- The release tarball + SHA256SUMS assets may still be published for auditability, but
  they are no longer the install path.
- Checksummed/signed artifacts could return later as an *additional* verification step
  layered on git tags, if release signing custody is established.
