import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const HARNESS_LEDGER_DEFAULT_PATH = ".harness/evolution/events.jsonl";

export type HarnessEventType =
  | "gate_failure"
  | "gate_pass"
  | "review_disagreement"
  | "wave_handoff_rejected"
  | "delivery_gate_failed"
  | "manual_override"
  | "harness_change";

export interface HarnessEvent {
  type: HarnessEventType;
  taskId: string;
  model?: string;
  summary: string;
  evidence?: string[];
  outcome: string;
  createdAt: string;
}

export function serializeHarnessEvent(event: HarnessEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export async function appendHarnessEvent(event: HarnessEvent, cwd = process.cwd()): Promise<void> {
  const path = join(cwd, HARNESS_LEDGER_DEFAULT_PATH);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, serializeHarnessEvent(event), "utf-8");
}
