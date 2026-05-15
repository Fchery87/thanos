export function matchGlob(pattern: string, value: string): boolean {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${re}$`).test(value);
}

export function matchSubstring(pattern: string, value: string): boolean {
  return value.includes(pattern.replace(/\*/g, ""));
}

export function matchesPattern(pattern: string, value: string): boolean {
  return matchGlob(pattern, value) || matchSubstring(pattern, value);
}
