import { defineConfig } from "vitest/config";

// Discovery is pinned to tests/ rather than left on vitest's default
// "**/*.test.ts" glob. Pi's runtime directories live *inside* this repo
// (agent/git/** for `pi update --extensions` clones, agent/npm/** for
// packages) and are gitignored but not hidden from vitest — the default
// exclude only skips **/node_modules/**. A third-party extension repo that
// ships its own bun:test files therefore got collected into this suite and
// failed at import with "Cannot find module 'bun:test'", turning `bun run
// test` red for code this repo does not own. Every test:* script in
// package.json already targets tests/, so this only removes foreign files.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
