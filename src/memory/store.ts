import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { LegacyMemoryRecord, MemoryRecord } from "./types";

export const MAX_MEMORY_LENGTH = 500;

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function normalize(record: MemoryRecord | LegacyMemoryRecord): MemoryRecord | null {
  const text = "text" in record && typeof record.text === "string"
    ? record.text
    : (record as LegacyMemoryRecord).correction;
  if (typeof text !== "string" || text.trim() === "") return null;
  return { id: record.id, project: record.project, text, timestamp: record.timestamp };
}

function readAll(filePath: string): MemoryRecord[] {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as (MemoryRecord | LegacyMemoryRecord)[];
    if (!Array.isArray(raw)) return [];
    return raw.map(normalize).filter((r): r is MemoryRecord => r !== null);
  } catch {
    return [];
  }
}

function writeAll(filePath: string, records: MemoryRecord[]): void {
  ensureDir(filePath);
  writeFileSync(filePath, JSON.stringify(records, null, 2), "utf-8");
}

export interface MemoryQuery {
  project: string;
  limit?: number;
}

export interface SaveResult {
  saved: boolean;
  /** Present when saved is false. */
  reason?: "empty" | "too-long" | "duplicate";
  /** Present when saved is true. */
  record?: MemoryRecord;
}

export class MemoryStore {
  private constructor(private readonly filePath: string) {}

  static open(filePath: string): MemoryStore {
    return new MemoryStore(filePath);
  }

  save(input: { project: string; text: string }): SaveResult {
    const text = input.text.trim();
    if (text === "") return { saved: false, reason: "empty" };
    if (text.length > MAX_MEMORY_LENGTH) return { saved: false, reason: "too-long" };
    const records = readAll(this.filePath);
    const duplicate = records.some((r) => r.project === input.project && r.text.trim() === text);
    if (duplicate) return { saved: false, reason: "duplicate" };
    const record: MemoryRecord = { id: randomUUID(), project: input.project, text, timestamp: Date.now() };
    records.push(record);
    writeAll(this.filePath, records);
    return { saved: true, record };
  }

  remove(id: string): boolean {
    const records = readAll(this.filePath);
    const next = records.filter((r) => r.id !== id);
    if (next.length === records.length) return false;
    writeAll(this.filePath, next);
    return true;
  }

  query(opts: MemoryQuery): MemoryRecord[] {
    const records = readAll(this.filePath);
    const filtered = records.filter((r) => r.project === opts.project);
    // Sort descending by timestamp; break ties by insertion order (higher index = newer).
    filtered.sort((a, b) => {
      const byTime = b.timestamp - a.timestamp;
      if (byTime !== 0) return byTime;
      return records.indexOf(b) - records.indexOf(a);
    });
    return filtered.slice(0, opts.limit ?? 20);
  }

  all(): MemoryRecord[] {
    return readAll(this.filePath);
  }
}
