import type { ContextAuthority, ContextEnvelope, ContextOrigin, ContextScope } from "./envelope";

// Built from character codes, not a literal regex, so this source file never
// carries raw control bytes. Matches 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F, 0x7F.
const CONTROL_CODEPOINTS: number[] = [];
for (let code = 0x00; code <= 0x08; code += 1) CONTROL_CODEPOINTS.push(code);
CONTROL_CODEPOINTS.push(0x0b, 0x0c);
for (let code = 0x0e; code <= 0x1f; code += 1) CONTROL_CODEPOINTS.push(code);
CONTROL_CODEPOINTS.push(0x7f);
const CONTROL_CHARS_PATTERN = CONTROL_CODEPOINTS.map((code) => String.fromCharCode(code)).join("");

function containsControlChars(content: string): boolean {
  for (let i = 0; i < content.length; i += 1) {
    if (CONTROL_CHARS_PATTERN.includes(content[i] as string)) return true;
  }
  return false;
}

// \n and \r are deliberately absent from CONTROL_CHARS_PATTERN: `content` is
// JSON-escaped before it lands in the output, so a raw newline there is safe
// (it becomes `\n` in the escaped string). `id`/`source` are interpolated
// unescaped as `field:value` — a raw newline there would forge a new line
// that reads as its own field, defeating the fixed-field-order guarantee.
function isSafeSingleLineField(value: string): boolean {
  return !containsControlChars(value) && !value.includes("\n") && !value.includes("\r");
}

const VALID_SCOPES: ReadonlySet<ContextScope> = new Set(["user", "project", "session", "turn"]);
const VALID_ORIGINS: ReadonlySet<ContextOrigin> = new Set(["user", "project", "memory", "tool", "subagent", "harness"]);
const VALID_AUTHORITIES: ReadonlySet<ContextAuthority> = new Set(["instruction", "preference", "request", "evidence"]);

function escapeContent(content: string): string {
  return JSON.stringify(content);
}

function isValidOptionalTimestamp(value: string | undefined): boolean {
  return value === undefined || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}

/**
 * Renders one envelope as a fixed-order, quoted block: hostile content —
 * fake headers, JSON delimiters, role labels, embedded instructions — stays
 * inside the escaped `content:` field rather than breaking out into
 * something that reads as a new section. Throws on anything malformed so a
 * caller can choose to omit the block rather than deliver bad data; see
 * `renderContextEnvelopeOrOmit` for that path.
 */
export function renderContextEnvelope(envelope: ContextEnvelope): string {
  if (typeof envelope.id !== "string" || envelope.id.trim() === "" || !isSafeSingleLineField(envelope.id)) {
    throw new Error("Context envelope requires a non-empty id with no line breaks or control characters.");
  }
  if (!VALID_SCOPES.has(envelope.scope)) {
    throw new Error(`Context envelope ${envelope.id} has an unrecognized scope.`);
  }
  if (!VALID_ORIGINS.has(envelope.origin)) {
    throw new Error(`Context envelope ${envelope.id} has an unrecognized origin.`);
  }
  if (!VALID_AUTHORITIES.has(envelope.authority)) {
    throw new Error(`Context envelope ${envelope.id} has an unrecognized authority.`);
  }
  if (typeof envelope.source !== "string" || envelope.source.trim() === "" || !isSafeSingleLineField(envelope.source)) {
    throw new Error(`Context envelope ${envelope.id} requires a non-empty source.`);
  }
  if (!isValidOptionalTimestamp(envelope.capturedAt) || !isValidOptionalTimestamp(envelope.staleAfter)) {
    throw new Error(`Context envelope ${envelope.id} has an invalid capturedAt/staleAfter timestamp.`);
  }
  if (containsControlChars(envelope.content)) {
    throw new Error(`Context envelope ${envelope.id} contains unsupported control characters.`);
  }
  if (!Number.isFinite(envelope.maxBytes) || !Number.isInteger(envelope.maxBytes) || envelope.maxBytes <= 0) {
    throw new Error(`Context envelope ${envelope.id} has an invalid maxBytes.`);
  }

  const encoded = escapeContent(envelope.content);
  if (Buffer.byteLength(encoded, "utf8") > envelope.maxBytes) {
    throw new Error(`Context envelope ${envelope.id} exceeds the byte budget.`);
  }

  // Fixed field order so two envelopes with identical values always render
  // identically — block ordering elsewhere is the caller's responsibility.
  const lines = [
    `id:${envelope.id}`,
    `origin:${envelope.origin}`,
    `authority:${envelope.authority}`,
    `scope:${envelope.scope}`,
    `source:${envelope.source}`,
    `trusted:${envelope.trusted ? "true" : "false"}`,
  ];
  if (envelope.capturedAt) lines.push(`capturedAt:${envelope.capturedAt}`);
  if (envelope.staleAfter) lines.push(`staleAfter:${envelope.staleAfter}`);
  lines.push(`content:${encoded}`);
  return lines.join("\n");
}

/**
 * Same as `renderContextEnvelope`, but a malformed envelope is omitted
 * instead of failing the turn. Never mutates permissions, delivery, or
 * acceptance state — the only effect of a rejection is that one optional
 * block is missing from the prompt, plus a bounded, content-free diagnostic
 * (the thrown messages above never include `envelope.content`).
 */
export function renderContextEnvelopeOrOmit(envelope: ContextEnvelope): string | undefined {
  try {
    return renderContextEnvelope(envelope);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[harness][context] ${message}`);
    return undefined;
  }
}

/**
 * A plain `content:"..."` line for callers that want a bounded, quoted
 * fallback when `renderContextEnvelopeOrOmit` returns `undefined` — same
 * escaping as the real content field, but without the rest of the envelope.
 * Truncates by output bytes, not input characters: `JSON.stringify` escaping
 * (and multi-byte UTF-8) can expand a string, so slicing the raw input to
 * `maxBytes` characters does not guarantee the escaped, prefixed output fits
 * `maxBytes` bytes. Binary-searches the longest prefix whose escaped form
 * does.
 */
export function renderBoundedFallbackContent(content: string, maxBytes: number): string {
  const prefix = "content:";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(prefix, "utf8"));
  let lo = 0;
  let hi = content.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi + 1) / 2);
    if (Buffer.byteLength(JSON.stringify(content.slice(0, mid)), "utf8") <= budget) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return `${prefix}${JSON.stringify(content.slice(0, lo))}`;
}
