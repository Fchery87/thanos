import {
  evaluateRules,
  type Capability,
  type Decision,
  type PermissionRule,
} from "./rules";

const DEFAULT_RULES: PermissionRule[] = [
  { capability: "read", decision: "allow", source: "default" },
  { capability: "edit", decision: "ask",   source: "default" },
  { capability: "exec", decision: "ask",   source: "default" },
  { capability: "task", decision: "ask",   source: "default" },
];

export class PermissionManager {
  private rules: PermissionRule[];
  private _yolo = false;

  constructor(rules: PermissionRule[] = [...DEFAULT_RULES]) {
    this.rules = rules;
  }

  get isYolo(): boolean { return this._yolo; }

  setYolo(enabled: boolean): void { this._yolo = enabled; }

  evaluate(capability: Capability, target: string): Decision {
    if (this._yolo) return "allow";
    return evaluateRules(this.rules, capability, target);
  }

  remember(capability: Capability | "*", pattern: string, decision: Decision): void {
    if (!pattern || !pattern.trim()) throw new Error("pattern required — use \"**\" for wildcard intent");
    this.rules.push({ capability, pattern, decision, source: "session" });
  }

  clearSessionRules(): void {
    this.rules = this.rules.filter((r) => r.source !== "session");
  }
}
