import { minimatch } from "minimatch";
import { resolve } from "node:path";

const MINIMATCH_OPTS = { matchBase: true, dot: true, nocase: false } as const;

function toGlob(pattern: string): string {
  // A trailing slash means "match everything under this directory prefix"
  return pattern.endsWith("/") ? `${pattern}**` : pattern;
}

export function matchGlob(pattern: string, value: string): boolean {
  const glob = toGlob(pattern);
  const normalized = resolve(value);
  return minimatch(value, glob, MINIMATCH_OPTS)
    || minimatch(normalized, glob, MINIMATCH_OPTS);
}

export function matchesPattern(pattern: string, value: string): boolean {
  return matchGlob(pattern, value);
}
