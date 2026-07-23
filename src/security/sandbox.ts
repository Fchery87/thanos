/**
 * Delivery-gated launcher-level sandbox policy.
 *
 * PURE module: no filesystem/process I/O, no `bwrap` detection. Callers
 * (the `thanos` launcher script) are responsible for detecting `bwrap`
 * availability and platform, then feeding that plus the resolved delivery
 * state through `shouldSandbox`, and for actually spawning the argv that
 * `buildBwrapArgv` returns.
 *
 * Corrected design (see docs on Task 6/7): the base is `--ro-bind / /`, NOT
 * `--dev-bind / /`. `--dev-bind` mounts the whole host filesystem read-write
 * and provides ZERO containment; `--ro-bind` is what actually turns writes
 * outside the explicit `--bind` paths into hard "Read-only file system"
 * failures. This was empirically verified (see PR description / Task 6
 * writeup), not assumed.
 */

export type Platform = "linux" | "darwin" | "win32" | (string & {});
export type DeliveryModeLike = "local-only" | "direct-PR" | "no-mistakes";
export type DeliveryAutonomyLike = "attended" | "unattended";

export interface ShouldSandboxInput {
  platform: Platform;
  bwrapAvailable: boolean;
  mode: DeliveryModeLike;
  autonomy: DeliveryAutonomyLike;
  yolo: boolean;
}

export interface ShouldSandboxResult {
  /** Whether the caller should actually wrap the inner command in bwrap. */
  sandbox: boolean;
  /** What the caller should do: proceed (sandboxed or not), warn-and-proceed unsandboxed, or refuse to run at all. */
  action: "run" | "warn" | "deny";
  reason: string;
}

/**
 * Decide whether to engage the launcher-level bwrap sandbox for this run.
 *
 * Engagement conditions (all must hold):
 *   - platform === "linux"
 *   - bwrapAvailable
 *   - AND (mode === "no-mistakes" OR autonomy === "unattended" OR yolo === true)
 *
 * Never engages off-Linux, full stop — no deny/warn is produced there either,
 * since there's nothing to sandbox with on non-Linux platforms in v1.
 *
 * When the engagement conditions (mode/autonomy/yolo) are met but bwrap is
 * missing:
 *   - mode === "no-mistakes" -> deny (refuse to run at all: this mode's whole
 *     point is containment, so running unsandboxed would silently defeat it)
 *   - any other mode -> warn (proceed unsandboxed, but tell the operator why)
 */
export function shouldSandbox(input: ShouldSandboxInput): ShouldSandboxResult {
  const { platform, bwrapAvailable, mode, autonomy, yolo } = input;

  const wantsSandbox = mode === "no-mistakes" || autonomy === "unattended" || yolo === true;

  if (platform !== "linux") {
    return {
      sandbox: false,
      action: "run",
      reason: `sandbox not available on platform "${platform}" (linux-only in v1)`,
    };
  }

  if (!wantsSandbox) {
    return {
      sandbox: false,
      action: "run",
      reason: "delivery state does not require sandboxing (attended local-only, no yolo)",
    };
  }

  if (!bwrapAvailable) {
    if (mode === "no-mistakes") {
      return {
        sandbox: false,
        action: "deny",
        reason:
          "mode is no-mistakes but bwrap is not available; refusing to run unsandboxed",
      };
    }
    return {
      sandbox: false,
      action: "warn",
      reason: "bwrap is not available; proceeding unsandboxed",
    };
  }

  return {
    sandbox: true,
    action: "run",
    reason: `sandboxing engaged (mode=${mode} autonomy=${autonomy} yolo=${yolo})`,
  };
}

export interface BuildBwrapArgvInput {
  /** Repo root to bind read-write and chdir into. */
  repo: string;
  /** Scratch tmp directory to bind read-write (e.g. a fresh dir under os.tmpdir()). */
  tmp: string;
  /** Invoking user's home directory; only specific subdirs under it are bound rw. */
  home: string;
  /** The command to run inside the sandbox, e.g. ["pi", "--foo"]. */
  inner: string[];
}

/**
 * Files under `$home/.pi/agent` that must come back out read-only even
 * though the directory itself is bound read-write.
 *
 * SECURITY-CRITICAL, empirically verified live (not assumed): with only the
 * parent rw `--bind $home/.pi/agent $home/.pi/agent` in place, a process
 * running INSIDE the sandbox could overwrite `projects.json` — the captain
 * registry that is the SOLE trusted source of `mode`/`autonomy`/`yoloLocked`
 * (see src/governance/delivery.ts). The sandbox engages precisely for
 * `no-mistakes` / `unattended` / `yolo` runs — i.e. exactly the
 * least-trusted execution contexts — so an unrestricted rw bind let that
 * same untrusted context permanently escalate its own future trust by
 * rewriting the registry that decides whether it gets sandboxed at all. The
 * same rw bind also handed out write (not just the already-implicit
 * same-uid read) access to `auth.json` and `models.local.secret.json`.
 *
 * Reproduced live before the fix: `sh -c 'echo PWNED > "$HOME/.pi/agent/projects.json"'`
 * run as the sandboxed inner command succeeded and modified the real file on
 * the host disk.
 *
 * Each entry here is verified read-only-in-practice from a running `pi`
 * session (checked both this repo's src/ and node_modules/@earendil-works/
 * pi-coding-agent/dist for any write path before locking it):
 *   - projects.json            the trust registry itself (the exploit above)
 *   - auth.json                provider credentials
 *   - models.local.secret.json secrets (name says it all)
 *   - models.json               resolved model catalog; read via
 *                               src/agents/model-routing.ts and pi's own
 *                               config.js, never written by either — the
 *                               only writer of a same-named-directory file
 *                               is settings.json (via
 *                               node_modules/.../core/settings-manager.js
 *                               and our own writeJsonFile(settingsPath, ...)
 *                               calls), which is deliberately NOT in this
 *                               list because it IS written at runtime
 *                               (session toggles, /subagents-models, etc.)
 *   - trust.json                pi's own native project-trust store
 *                               (node_modules/.../core/trust-manager.js);
 *                               this repo's own trust check
 *                               (src/goal/command.ts's `ctx.isProjectTrusted()`)
 *                               only ever reads it, matching the Task 5
 *                               goal-resume trust check. Locking it means a
 *                               brand-new, never-before-trusted repo path
 *                               launched via `thanos` won't be able to
 *                               persist a first-run trust decision from
 *                               inside the sandbox — an accepted tradeoff,
 *                               since repos launched through delivery-gated
 *                               sandboxing are expected to already be known
 *                               to the registry (see resolveDeliveryState).
 *
 * `models-store.json` and `settings.json` are intentionally NOT locked: both
 * are genuinely written by a running session (model routing state, session
 * toggles) and locking them would break normal operation.
 *
 * Uses `--ro-bind-try` (not `--ro-bind`): these files are not guaranteed to
 * exist on every machine (e.g. a fresh install with no `auth.json` yet, or
 * no `models.local.secret.json` configured) and `--ro-bind` hard-fails the
 * whole sandbox setup when its source path is missing; `--ro-bind-try`
 * silently skips a missing source instead.
 *
 * IMPORTANT — `--ro-bind-try` skipping a missing source is exactly what
 * makes it non-hard-failing, but it ALSO means a genuinely missing file gets
 * no override mount at all, leaving the parent rw bind in force for it — a
 * sandboxed process could then CREATE that file with attacker content. The
 * caller (scripts/thanos-launch.mjs's `ensureSensitiveAgentFilesExist`) MUST
 * pre-create every entry in SENSITIVE_AGENT_FILES (using
 * SENSITIVE_AGENT_FILE_PLACEHOLDERS) before ever calling buildBwrapArgv, so
 * every `--ro-bind-try` here always has a real source to lock. See the
 * SENSITIVE_AGENT_FILE_PLACEHOLDERS doc comment above for the full story
 * (this was a live-reproduced Critical finding, fixed in a second round).
 */
export const SENSITIVE_AGENT_FILES = [
  "auth.json",
  "models.local.secret.json",
  "models.json",
  "projects.json",
  "trust.json",
] as const;

/**
 * SECURITY-CRITICAL, second-round fix: `--ro-bind-try` is a no-op when its
 * source path doesn't exist — so on a fresh install / freshly-provisioned
 * CI/container (no `auth.json` yet, no `trust.json` yet, ...), NO override
 * mount gets added for that file, and the parent rw `--bind $home/.pi/agent
 * $home/.pi/agent` stays in force for it. The sandboxed process can then
 * freely CREATE that file with fully attacker-controlled content, which
 * lands on the real host disk and becomes, e.g., the real trust registry
 * for all future launches.
 *
 * Reproduced live (see PR): with `projects.json` absent, `thanos --yolo`
 * alone (no registry needed — `--yolo` is one of shouldSandbox's own
 * engagement conditions) let the sandboxed process create a brand-new
 * `projects.json` with attacker-chosen `mode: "no-mistakes"` /
 * `autonomy: "unattended"` / unlocked yolo that persisted as the real
 * registry. Separately, with `auth.json` absent, the sandboxed process
 * created it from scratch with fabricated credentials.
 *
 * Fix: the launcher pre-creates any of these files that doesn't already
 * exist, with this exact placeholder content, BEFORE ever building/spawning
 * bwrap — so `--ro-bind-try` always has a real (empty-equivalent) source to
 * lock, regardless of whether the file pre-existed. Never overwrites a file
 * that already has real content (see scripts/thanos-launch.mjs's
 * `ensureSensitiveAgentFilesExist`, which only creates via an exclusive
 * `wx`-flag write and treats EEXIST as success).
 *
 * Each placeholder was chosen to be BEHAVIORALLY IDENTICAL to "file
 * missing" for its real consumer — not just "some valid JSON" — verified
 * per file, not assumed:
 *   - auth.json: `"{}"` — this is pi's OWN native placeholder. Pi's own
 *     `FileAuthStorageBackend.ensureFileExists()` (core/auth-storage.js)
 *     already writes exactly `"{}"` with mode 0o600 the first time any auth
 *     operation touches a missing auth.json. We're only doing slightly
 *     earlier what pi itself would do anyway — zero behavior change.
 *   - trust.json: `"{}"` — pi's own `readTrustFile` (core/trust-manager.js)
 *     special-cases a MISSING file to return `{}` directly, but would THROW
 *     on a genuinely empty (0-byte) file (`JSON.parse("")` fails, uncaught
 *     by any try/catch at the call site) — that would have broken every
 *     `pi` startup in the repo. `{}` is valid JSON, parses to an empty
 *     object, and produces the exact same `{}` result as the missing-file
 *     branch — confirmed by reading readTrustFile's source, not assumed.
 *   - projects.json: the literal fallback registry
 *     `{"version":1,"default":{"mode":"local-only","autonomy":"attended"},"projects":[]}`
 *     — this is byte-for-byte what `resolveDelivery` in
 *     src/governance/delivery.ts already falls back to today when the
 *     registry file is missing (`registry?.default ?? { mode: "local-only",
 *     autonomy: "attended" }` with an empty project list, i.e. no match).
 *     Pre-creating it changes NOTHING about the resolved mode/autonomy for
 *     any repo — it only takes the implicit fallback and makes it an
 *     explicit, schema-valid file so `--ro-bind-try` can lock it.
 *   - models.json: `{"providers":{}}` — NOT bare `{}`. Pi's own
 *     `ModelRegistry.loadCustomModels` (core/model-registry.js) requires a
 *     `providers` key (`Type.Record(...)`, not optional) to pass schema
 *     validation; bare `{}` would still be caught gracefully (no crash) but
 *     would surface an "Invalid models.json schema" error message.
 *     `{"providers":{}}` validates cleanly and yields zero custom
 *     models/overrides with `error: undefined` — the true no-warning
 *     equivalent of "file missing" (which also yields zero custom models,
 *     via the same `existsSync` early-return).
 *   - models.local.secret.json: `{"providers":{}}` — no consumer of this
 *     exact filename was found anywhere in this repo's src/scripts or in
 *     pi-coding-agent's dist (grepped both); its real on-disk shape on a
 *     configured machine is the same `{"providers": {...}}` shape as
 *     models.json, so this mirrors that convention as the most conservative
 *     "nothing configured" placeholder. Flagged here rather than silently
 *     assumed, since no direct verification was possible for this one file.
 */
export const SENSITIVE_AGENT_FILE_PLACEHOLDERS: Readonly<
  Record<(typeof SENSITIVE_AGENT_FILES)[number], string>
> = {
  "auth.json": "{}\n",
  "trust.json": "{}\n",
  "projects.json": `${JSON.stringify(
    { version: 1, default: { mode: "local-only", autonomy: "attended" }, projects: [] },
    null,
    2,
  )}\n`,
  "models.json": '{"providers":{}}\n',
  "models.local.secret.json": '{"providers":{}}\n',
};

/**
 * Build the argv for the corrected bwrap invocation:
 *
 *   bwrap \
 *     --ro-bind / / \
 *     --dev /dev \
 *     --proc /proc \
 *     --tmpfs /tmp \
 *     --bind "$repo" "$repo" \
 *     --bind "$tmp" "$tmp" \
 *     --bind "$home/.pi/agent" "$home/.pi/agent" \
 *     --ro-bind-try "$home/.pi/agent/auth.json" "$home/.pi/agent/auth.json" \
 *     --ro-bind-try "$home/.pi/agent/models.local.secret.json" "$home/.pi/agent/models.local.secret.json" \
 *     --ro-bind-try "$home/.pi/agent/models.json" "$home/.pi/agent/models.json" \
 *     --ro-bind-try "$home/.pi/agent/projects.json" "$home/.pi/agent/projects.json" \
 *     --ro-bind-try "$home/.pi/agent/trust.json" "$home/.pi/agent/trust.json" \
 *     --bind "$home/.bun" "$home/.bun" \
 *     --chdir "$repo" \
 *     --unshare-all --share-net \
 *     --die-with-parent \
 *     -- <inner...>
 *
 * The per-file `--ro-bind-try` entries MUST come after the parent rw
 * `--bind $home/.pi/agent $home/.pi/agent`: bwrap applies bind mounts in
 * argv order and a later mount at an overlapping path wins, so the specific
 * files get re-locked to read-only while the rest of the directory (session
 * state, run-history, models-store.json, settings.json) stays writable.
 * This ordering was verified empirically, the same way the base
 * `--ro-bind / /` design was verified in Task 6 — see PR description for
 * the exact before/after repro.
 *
 * No `$home/.cache` bind: empirically verified via `strace -f -e trace=open,openat`
 * on real `pi --version` / `pi list` invocations that neither `pi` nor its
 * dependencies touch anything under `~/.cache` (the only ".cache" hits were
 * the OS-level `/etc/ld.so.cache`, already visible read-only via the
 * `--ro-bind / /` base — no explicit bind needed for it). `bun`'s own
 * package cache lives entirely under `~/.bun` (`bun pm cache` ->
 * `~/.bun/install/cache`), which is already bound separately. `~/.cache` on
 * a real dev machine holds ~30+ unrelated apps' cache dirs (browsers,
 * editors, go-build, ...) that a sandboxed session has no legitimate reason
 * to read OR write — so the bind is dropped rather than narrowed, since
 * nothing under it is actually needed at all.
 *
 * CAVEAT (documented, not yet independently verified): the strace check
 * above only covers `pi --version` / `pi list`. It does NOT cover a `/goal`
 * session or an MCP-backed/subagent spawn running inside the same sandboxed
 * process tree, which could shell out to a tool that defaults to `~/.cache`
 * (e.g. a Puppeteer-backed MCP server). Dropping the bind is judged
 * defensible as a default — failing loudly and narrow beats a 30-app-wide rw
 * hole — but is not exhaustively proven for those paths. If a future
 * sandboxed run needs something under `~/.cache`, it will fail loudly
 * (missing dir/file) rather than silently, which is the intended failure
 * mode; re-verify with strace across those paths before assuming this is
 * airtight.
 *
 * `--die-with-parent` is load-bearing, not cosmetic: bubblewrap forks an
 * outer setup process and an inner "container init"/reaper process for the
 * new pid namespace. Empirically verified: without `--die-with-parent`,
 * sending SIGTERM to the outer `bwrap` process (e.g. because the launcher
 * itself is being torn down) kills only that outer process — the inner
 * bwrap reaper and the sandboxed command underneath it get reparented and
 * keep running as orphans, invisible to whatever was supervising the
 * launcher. `--die-with-parent` (bwrap's own documented flag for exactly
 * this) makes bwrap SIGKILL the sandboxed command when bwrap or bwrap's
 * parent dies, so the whole sandboxed process tree tears down together.
 */
export function buildBwrapArgv(input: BuildBwrapArgvInput): string[] {
  const { repo, tmp, home, inner } = input;
  const agentDir = `${home}/.pi/agent`;

  const relockSensitiveFiles = SENSITIVE_AGENT_FILES.flatMap((name) => {
    const path = `${agentDir}/${name}`;
    return ["--ro-bind-try", path, path];
  });

  return [
    "bwrap",
    "--ro-bind", "/", "/",
    "--dev", "/dev",
    "--proc", "/proc",
    "--tmpfs", "/tmp",
    "--bind", repo, repo,
    "--bind", tmp, tmp,
    "--bind", agentDir, agentDir,
    ...relockSensitiveFiles,
    "--bind", `${home}/.bun`, `${home}/.bun`,
    "--chdir", repo,
    "--unshare-all", "--share-net",
    "--die-with-parent",
    "--",
    ...inner,
  ];
}
