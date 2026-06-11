export interface MemoryRecord {
  id: string;
  project: string;
  text: string;
  timestamp: number;
}

// Legacy records written by the removed auto-capture path carried extra
// always-empty fields and named the text `correction`. The store normalizes
// them on read so existing .harness/memory.json files keep working.
export interface LegacyMemoryRecord {
  id: string;
  project: string;
  spec_tier?: string;
  capability?: string;
  pattern?: string;
  correction: string;
  timestamp: number;
}
