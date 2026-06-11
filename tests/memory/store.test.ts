import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore, MAX_MEMORY_LENGTH } from "../../src/memory/store";

let dir: string;
let dbPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "harness-memory-"));
  dbPath = join(dir, "memory.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("MemoryStore", () => {
  it("saves and queries records by project", () => {
    const store = MemoryStore.open(dbPath);
    expect(store.save({ project: "my-app", text: "don't use var" }).saved).toBe(true);
    expect(store.save({ project: "other-app", text: "unrelated" }).saved).toBe(true);

    const results = store.query({ project: "my-app" });
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("don't use var");
    expect(results[0].project).toBe("my-app");
  });

  it("rejects empty and whitespace-only text", () => {
    const store = MemoryStore.open(dbPath);
    expect(store.save({ project: "proj", text: "" })).toEqual({ saved: false, reason: "empty" });
    expect(store.save({ project: "proj", text: "   " })).toEqual({ saved: false, reason: "empty" });
    expect(store.all()).toHaveLength(0);
  });

  it("rejects text over the length cap", () => {
    const store = MemoryStore.open(dbPath);
    const result = store.save({ project: "proj", text: "a".repeat(MAX_MEMORY_LENGTH + 1) });
    expect(result).toEqual({ saved: false, reason: "too-long" });
    expect(store.save({ project: "proj", text: "a".repeat(MAX_MEMORY_LENGTH) }).saved).toBe(true);
  });

  it("rejects duplicates within the same project but allows them across projects", () => {
    const store = MemoryStore.open(dbPath);
    expect(store.save({ project: "proj", text: "use bun" }).saved).toBe(true);
    expect(store.save({ project: "proj", text: "  use bun  " })).toEqual({ saved: false, reason: "duplicate" });
    expect(store.save({ project: "other", text: "use bun" }).saved).toBe(true);
  });

  it("trims text before saving", () => {
    const store = MemoryStore.open(dbPath);
    const result = store.save({ project: "proj", text: "  hello  " });
    expect(result.saved && result.record.text).toBe("hello");
  });

  it("removes a record by id and reports misses", () => {
    const store = MemoryStore.open(dbPath);
    const result = store.save({ project: "proj", text: "to be forgotten" });
    if (!result.saved) throw new Error("save failed");
    expect(store.remove(result.record.id)).toBe(true);
    expect(store.remove(result.record.id)).toBe(false);
    expect(store.all()).toHaveLength(0);
  });

  it("returns most recent records first", () => {
    const store = MemoryStore.open(dbPath);
    store.save({ project: "proj", text: "first" });
    store.save({ project: "proj", text: "second" });

    const results = store.query({ project: "proj" });
    expect(results[0].text).toBe("second");
    expect(results[1].text).toBe("first");
  });

  it("respects the limit option", () => {
    const store = MemoryStore.open(dbPath);
    for (let i = 0; i < 5; i++) {
      store.save({ project: "proj", text: `item ${i}` });
    }

    const results = store.query({ project: "proj", limit: 3 });
    expect(results).toHaveLength(3);
  });

  it("returns empty array when db file does not exist yet", () => {
    const store = MemoryStore.open(join(dir, "nonexistent.json"));
    expect(store.query({ project: "anything" })).toEqual([]);
  });

  it("assigns unique ids and timestamps to each record", () => {
    const store = MemoryStore.open(dbPath);
    store.save({ project: "proj", text: "a" });
    store.save({ project: "proj", text: "b" });

    const all = store.all();
    expect(all[0].id).not.toBe(all[1].id);
    expect(all[0].timestamp).toBeTypeOf("number");
  });

  it("normalizes legacy auto-capture records on read", async () => {
    await writeFile(dbPath, JSON.stringify([
      { id: "legacy-1", project: "proj", spec_tier: "ambient", capability: "", pattern: "", correction: "old preference", timestamp: 1 },
      { id: "legacy-2", project: "proj", spec_tier: "", capability: "", pattern: "", correction: "", timestamp: 2 },
    ]));
    const store = MemoryStore.open(dbPath);
    const results = store.query({ project: "proj" });
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe("old preference");
    // saving alongside a legacy record dedupes against its normalized text
    expect(store.save({ project: "proj", text: "old preference" })).toEqual({ saved: false, reason: "duplicate" });
  });
});
