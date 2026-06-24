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
  private _yolo = true;
  private _locked = false;

  constructor(rules: PermissionRule[] = [...DEFAULT_RULES]) {
    this.rules = rules;
  }

  get yoloLocked(): boolean { return this._locked; }

  lockYolo(): void {
    this._locked = true;
    this._yolo = false;
  }

  get isYolo(): boolean { return this._locked ? false : this._yolo; }

  setYolo(enabled: boolean): void {
    if (this._locked) return;
    this._yolo = enabled;
  }

  evaluate(capability: Capability, target: string): Decision {
    if (this.isYolo) return "allow";
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
