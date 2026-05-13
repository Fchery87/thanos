import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryRecord } from "./types";

function ensureDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}

function readAll(filePath: string): MemoryRecord[] {
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as MemoryRecord[];
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
  spec_tier?: string;
  capability?: string;
  limit?: number;
}

export class MemoryStore {
  private constructor(private readonly filePath: string) {}

  static open(filePath: string): MemoryStore {
    return new MemoryStore(filePath);
  }

  save(record: Omit<MemoryRecord, "id" | "timestamp">): void {
    const records = readAll(this.filePath);
    records.push({ id: randomUUID(), timestamp: Date.now(), ...record });
    writeAll(this.filePath, records);
  }

  query(opts: MemoryQuery): MemoryRecord[] {
    const records = readAll(this.filePath);
    const filtered = records
      .filter((r) => r.project === opts.project)
      .filter((r) => !opts.spec_tier || r.spec_tier === opts.spec_tier)
      .filter((r) => !opts.capability || r.capability === opts.capability);
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
