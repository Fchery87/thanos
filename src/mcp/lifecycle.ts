import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ServerStatus } from "./manager";
import type { MCPServerConfig } from "./types";

export type McpLifecycleAction = "session-init" | "reload" | "enable" | "disable" | "connect" | "disconnect";
export type McpServerLifecycleAction = Exclude<McpLifecycleAction, "session-init" | "reload">;

export interface McpLifecycleManagerLike {
  initialize(pi: ExtensionAPI, cwd: string, trust?: { projectApproved?: boolean }): Promise<void>;
  disconnect(): void;
  enableServer(pi: ExtensionAPI, name: string): Promise<boolean>;
  disableServer(name: string): Promise<boolean>;
  connectServer(pi: ExtensionAPI, name: string): Promise<boolean>;
  disconnectServer(name: string): boolean;
  getConfig(name: string): MCPServerConfig | undefined;
  getStatuses(): ServerStatus[];
}

interface McpLifecycleSnapshot {
  statuses: ServerStatus[];
  connectedCount: number;
}

interface McpLifecycleBaseResult {
  action: McpLifecycleAction;
  statuses: ServerStatus[];
  connectedCount: number;
  name?: string;
  status?: ServerStatus;
}

export interface McpLifecycleOkResult extends McpLifecycleBaseResult {
  kind: "ok";
}

export interface McpLifecycleUnknownServerResult extends McpLifecycleBaseResult {
  kind: "unknown-server";
  action: McpServerLifecycleAction;
  name: string;
}

export interface McpLifecycleNotConnectedResult extends McpLifecycleBaseResult {
  kind: "not-connected";
  action: "disconnect";
  name: string;
}

export interface McpLifecycleFailedResult extends McpLifecycleBaseResult {
  kind: "failed";
  error: string;
}

export type McpLifecycleResult =
  | McpLifecycleOkResult
  | McpLifecycleUnknownServerResult
  | McpLifecycleNotConnectedResult
  | McpLifecycleFailedResult;

function connectedCount(statuses: readonly ServerStatus[]): number {
  let count = 0;
  for (const status of statuses) {
    if (status.connected) count += 1;
  }
  return count;
}

function snapshot(manager: McpLifecycleManagerLike): McpLifecycleSnapshot {
  const statuses = manager.getStatuses();
  return { statuses, connectedCount: connectedCount(statuses) };
}

function latestStatus(manager: McpLifecycleManagerLike, name: string): ServerStatus | undefined {
  return manager.getStatuses().find((status) => status.name === name);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Pi's project-trust answer, or `false` if it cannot be obtained.
 *
 * The only caller that previously used `isProjectTrusted` did so behind another
 * condition, so an absent method never surfaced. Reading it unconditionally has
 * to tolerate a host that does not provide it — and the tolerant answer here is
 * "not trusted", since the alternative is launching a repo's chosen command
 * because a capability check threw.
 */
export function readProjectTrust(ctx: { isProjectTrusted?: () => boolean }): boolean {
  try {
    return typeof ctx.isProjectTrusted === "function" && ctx.isProjectTrusted() === true;
  } catch {
    return false;
  }
}

function okResult(action: McpLifecycleAction, manager: McpLifecycleManagerLike, extra?: Partial<McpLifecycleOkResult>): McpLifecycleOkResult {
  const { statuses, connectedCount: count } = snapshot(manager);
  return { kind: "ok", action, statuses, connectedCount: count, ...extra };
}

function failedResult(action: McpLifecycleAction, manager: McpLifecycleManagerLike, extra?: Partial<McpLifecycleFailedResult>): McpLifecycleFailedResult {
  const { statuses, connectedCount: count } = snapshot(manager);
  return { kind: "failed", action, statuses, connectedCount: count, error: "Unknown MCP lifecycle failure.", ...extra };
}

function unknownResult(action: McpServerLifecycleAction, name: string, manager: McpLifecycleManagerLike): McpLifecycleUnknownServerResult {
  const { statuses, connectedCount } = snapshot(manager);
  return { kind: "unknown-server", action, name, statuses, connectedCount };
}

export async function initializeMcpSession(params: {
  manager: McpLifecycleManagerLike;
  pi: ExtensionAPI;
  cwd: string;
  /**
   * Whether the human has vouched for this project (pi's `isProjectTrusted()`).
   * Governs whether a project-supplied mcp.json may launch its servers. Omitted
   * means no, which is the answer that cannot go wrong.
   */
  projectApproved?: boolean;
}): Promise<McpLifecycleResult> {
  const { manager, pi, cwd, projectApproved } = params;
  try {
    await manager.initialize(pi, cwd, { projectApproved: projectApproved === true });
    return okResult("session-init", manager);
  } catch (err) {
    return failedResult("session-init", manager, { error: errorMessage(err) });
  }
}

export async function reloadMcpSession(params: {
  manager: McpLifecycleManagerLike;
  pi: ExtensionAPI;
  cwd: string;
  /** Same meaning as in `initializeMcpSession`, and it must be passed here too:
   * a reload re-runs initialize, so omitting it would silently downgrade a
   * trusted project to untrusted and block servers that were working. */
  projectApproved?: boolean;
}): Promise<McpLifecycleResult> {
  const { manager, pi, cwd, projectApproved } = params;
  manager.disconnect();
  try {
    await manager.initialize(pi, cwd, { projectApproved: projectApproved === true });
    return okResult("reload", manager);
  } catch (err) {
    return failedResult("reload", manager, { error: errorMessage(err) });
  }
}

export async function enableMcpServer(params: {
  manager: McpLifecycleManagerLike;
  pi: ExtensionAPI;
  name: string;
}): Promise<McpLifecycleResult> {
  const { manager, pi, name } = params;
  if (!manager.getConfig(name)) {
    return unknownResult("enable", name, manager);
  }

  try {
    const ok = await manager.enableServer(pi, name);
    const status = latestStatus(manager, name);
    if (!ok) {
      return failedResult("enable", manager, {
        name,
        status,
        error: status?.error ?? `Failed to enable ${name}.`,
      });
    }
    return okResult("enable", manager, { name, status });
  } catch (err) {
    return failedResult("enable", manager, { name, status: latestStatus(manager, name), error: errorMessage(err) });
  }
}

export async function disableMcpServer(params: {
  manager: McpLifecycleManagerLike;
  name: string;
}): Promise<McpLifecycleResult> {
  const { manager, name } = params;
  if (!manager.getConfig(name)) {
    return unknownResult("disable", name, manager);
  }

  try {
    const ok = await manager.disableServer(name);
    const status = latestStatus(manager, name);
    if (!ok) {
      return failedResult("disable", manager, {
        name,
        status,
        error: status?.error ?? `Failed to disable ${name}.`,
      });
    }
    return okResult("disable", manager, { name, status });
  } catch (err) {
    return failedResult("disable", manager, { name, status: latestStatus(manager, name), error: errorMessage(err) });
  }
}

export async function connectMcpServer(params: {
  manager: McpLifecycleManagerLike;
  pi: ExtensionAPI;
  name: string;
}): Promise<McpLifecycleResult> {
  const { manager, pi, name } = params;
  if (!manager.getConfig(name)) {
    return unknownResult("connect", name, manager);
  }

  try {
    const ok = await manager.connectServer(pi, name);
    const status = latestStatus(manager, name);
    if (!ok) {
      return failedResult("connect", manager, {
        name,
        status,
        error: status?.error ?? `Failed to connect ${name}.`,
      });
    }
    return okResult("connect", manager, { name, status });
  } catch (err) {
    return failedResult("connect", manager, { name, status: latestStatus(manager, name), error: errorMessage(err) });
  }
}

export function disconnectMcpServer(params: {
  manager: McpLifecycleManagerLike;
  name: string;
}): McpLifecycleResult {
  const { manager, name } = params;
  const known = manager.getConfig(name) !== undefined;

  try {
    const ok = manager.disconnectServer(name);
    const { statuses, connectedCount } = snapshot(manager);
    const status = latestStatus(manager, name);

    if (!ok) {
      if (!known) {
        return { kind: "unknown-server", action: "disconnect", name, statuses, connectedCount };
      }
      return { kind: "not-connected", action: "disconnect", name, statuses, connectedCount };
    }

    return { kind: "ok", action: "disconnect", name, statuses, connectedCount, status };
  } catch (err) {
    return failedResult("disconnect", manager, { name, status: latestStatus(manager, name), error: errorMessage(err) });
  }
}
