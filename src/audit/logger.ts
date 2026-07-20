import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { redactSensitive } from "../observability/redaction";
import type { AuditEvent } from "./types";

function safeAuditTarget(target: AuditEvent["target"]): AuditEvent["target"] {
  if (target && "value" in target && typeof target.value === "string") {
    return { ...target, value: redactSensitive(target.value) };
  }
  return target;
}

function safeAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ...event,
    target: safeAuditTarget(event.target),
  };
}

export class AuditLogger {
  constructor(private path: string) {}

  async record(event: AuditEvent): Promise<void> {
    const safe = safeAuditEvent(event);
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(safe) + "\n", "utf-8");
  }
}
