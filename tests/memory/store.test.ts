import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "../../src/memory/store";

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
    store.save({ project: "my-app", spec_tier: "ambient", capability: "edit", pattern: "refactor", correction: "don't use var" });
    store.save({ project: "other-app", spec_tier: "ambient", capability: "edit", pattern: "", correction: "unrelated" });

    const results = store.query({ project: "my-app" });
    expect(results).toHaveLength(1);
    expect(results[0].correction).toBe("don't use var");
    expect(results[0].project).toBe("my-app");
  });

  it("filters by spec_tier", () => {
    const store = MemoryStore.open(dbPath);
    store.save({ project: "proj", spec_tier: "ambient", capability: "", pattern: "", correction: "ambient rule" });
    store.save({ project: "proj", spec_tier: "explicit", capability: "", pattern: "", correction: "explicit rule" });

    const results = store.query({ project: "proj", spec_tier: "ambient" });
    expect(results).toHaveLength(1);
    expect(results[0].correction).toBe("ambient rule");
  });

  it("filters by capability", () => {
    const store = MemoryStore.open(dbPath);
    store.save({ project: "proj", spec_tier: "", capability: "edit", pattern: "", correction: "edit pref" });
    store.save({ project: "proj", spec_tier: "", capability: "exec", pattern: "", correction: "exec pref" });

    const results = store.query({ project: "proj", capability: "exec" });
    expect(results).toHaveLength(1);
    expect(results[0].correction).toBe("exec pref");
  });

  it("returns most recent records first", () => {
    const store = MemoryStore.open(dbPath);
    store.save({ project: "proj", spec_tier: "", capability: "", pattern: "", correction: "first" });
    store.save({ project: "proj", spec_tier: "", capability: "", pattern: "", correction: "second" });

    const results = store.query({ project: "proj" });
    expect(results[0].correction).toBe("second");
    expect(results[1].correction).toBe("first");
  });

  it("respects the limit option", () => {
    const store = MemoryStore.open(dbPath);
    for (let i = 0; i < 5; i++) {
      store.save({ project: "proj", spec_tier: "", capability: "", pattern: "", correction: `item ${i}` });
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
    store.save({ project: "proj", spec_tier: "", capability: "", pattern: "", correction: "a" });
    store.save({ project: "proj", spec_tier: "", capability: "", pattern: "", correction: "b" });

    const all = store.all();
    expect(all[0].id).not.toBe(all[1].id);
    expect(all[0].timestamp).toBeTypeOf("number");
  });
});
