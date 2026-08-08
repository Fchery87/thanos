#!/usr/bin/env node
// Thin CLI entry point — the actual orchestration logic lives in
// scripts/thanos-update-lib.mjs. Split out so tests can import that logic
// directly without ESM-importing a shebang-prefixed file, which fails to
// parse on Windows CI (esbuild/vite-node's shebang handling chokes there).
// This file's shebang IS load-bearing (package.json's "bin" entry for
// `thanos-update` runs it directly), so — unlike
// scripts/patch-pi-subagents.mjs, whose shebang was just decorative and got
// deleted — the fix here was splitting importable logic out from the
// executable entry point instead.
import { main } from "./thanos-update-lib.mjs";

main().catch((err) => {
  console.error("[thanos-update] unexpected failure:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
