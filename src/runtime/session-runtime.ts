import type { AuditLogger } from "../audit/logger";
import type { PermissionManager } from "../permissions/manager";
import type { SpecEngine } from "../spec/engine";
import type { DeliveryMode, DeliveryAutonomy, ResolvedDelivery } from "../governance/delivery";
import type { HarnessPolicy } from "../policy/types";
import { GovernanceRuntime, type GovernanceContext } from "./governance-runtime";

export type SessionState =
  | "created"
  | "policy_ready"
  | "services_starting"
  | "ready"
  | "reconfiguring"
  | "stopping"
  | "stopped"
  | "failed";

export interface SessionStartContext {
  sessionId: string;
  agentType: "parent" | "subagent";
  cwd: string;
  hasUI: boolean;
}

export interface SessionRuntimeState {
  sessionId: string;
  agentType: "parent" | "subagent";
  state: SessionState;
  permissions: PermissionManager;
  spec: SpecEngine;
  delivery: ResolvedDelivery | undefined;
  policy: HarnessPolicy | undefined;
  auditLogger: AuditLogger | undefined;
  governance: GovernanceRuntime | undefined;
}

export class SessionRuntime {
  private _state: SessionRuntimeState;

  constructor(initial: {
    sessionId: string;
    agentType: "parent" | "subagent";
    permissions: PermissionManager;
    spec: SpecEngine;
  }) {
    this._state = {
      sessionId: initial.sessionId,
      agentType: initial.agentType,
      state: "created",
      permissions: initial.permissions,
      spec: initial.spec,
      delivery: undefined,
      policy: undefined,
      auditLogger: undefined,
      governance: undefined,
    };
  }

  get state(): SessionState {
    return this._state.state;
  }

  get permissions(): PermissionManager {
    return this._state.permissions;
  }

  get spec(): SpecEngine {
    return this._state.spec;
  }

  transition(to: SessionState): void {
    this._state.state = to;
  }

  configureDelivery(delivery: ResolvedDelivery): void {
    this._state.delivery = delivery;
  }

  configurePolicy(policy: HarnessPolicy): void {
    this._state.policy = policy;
  }

  setAuditLogger(logger: AuditLogger): void {
    this._state.auditLogger = logger;
  }

  createGovernance(ctx: GovernanceContext): GovernanceRuntime {
    const gov = new GovernanceRuntime(ctx);
    this._state.governance = gov;
    return gov;
  }

  get governance(): GovernanceRuntime | undefined {
    return this._state.governance;
  }

  get delivery(): ResolvedDelivery | undefined {
    return this._state.delivery;
  }

  get policy(): HarnessPolicy | undefined {
    return this._state.policy;
  }

  async stop(): Promise<void> {
    this._state.state = "stopping";
    this._state.state = "stopped";
  }
}
