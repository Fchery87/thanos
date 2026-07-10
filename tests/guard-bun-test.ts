// Fail-fast guard: this repo's suite is vitest ("bun run test"), not bun:test.
// Bare `bun test` runs the same *.test.ts files under bun's built-in runner,
// whose vitest shim lacks vi.mocked and does not apply vi.mock module mocks —
// producing dozens of misleading failures (and letting delivery tests read the
// real ~/.pi registry). Loaded only by bun:test via bunfig.toml [test].preload.
throw new Error('This repo uses vitest — run "bun run test", not "bun test".');
