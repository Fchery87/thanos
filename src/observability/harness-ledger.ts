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
  | "harness_change"
  | "spec_extraction"
  | "goal_set"
  | "goal_achieved"
  | "goal_paused"
  | "waves_lifecycle";

/**
 * Bumped only if a producer starts writing a row shape an old reader can't
 * parse. Optional per row (older rows and non-decision-relevant event types
 * omit it) so this stays backward compatible rather than forcing every
 * producer to declare a version up front.
 */
export const HARNESS_EVENT_SCHEMA_VERSION = 1;

export interface HarnessEvent {
  type: HarnessEventType;
  taskId: string;
  model?: string;
  summary: string;
  evidence?: string[];
  outcome: string;
  createdAt: string;
  /** See HARNESS_EVENT_SCHEMA_VERSION. */
  schemaVersion?: number;
  /** Repository/cwd this row was recorded in — the ledger is per-repo, so this identifies which one. */
  repository?: string;
  /** Effective budget in force when this row was recorded, where relevant (e.g. an extractor timeout). */
  timeoutMs?: number;
}

export function serializeHarnessEvent(event: HarnessEvent): string {
  return `${JSON.stringify(event)}\n`;
}

export async function appendHarnessEvent(event: HarnessEvent, cwd = process.cwd()): Promise<void> {
  const path = join(cwd, HARNESS_LEDGER_DEFAULT_PATH);
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, serializeHarnessEvent(event), "utf-8");
}

export function createOrderedHarnessRecorder(
  cwd = process.cwd(),
): (event: HarnessEvent) => Promise<void> {
  let tail = Promise.resolve();
  return (event) => {
    const write = tail.then(() => appendHarnessEvent(event, cwd));
    tail = write.catch(() => {});
    return write;
  };
}
