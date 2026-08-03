import type { ContextEnvelope, ContextScope } from "./envelope";

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

const VALID_SCOPES: ReadonlySet<ContextScope> = new Set(["user", "project", "session", "turn"]);

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
  if (typeof envelope.id !== "string" || envelope.id.trim() === "") {
    throw new Error("Context envelope requires a non-empty id.");
  }
  if (!VALID_SCOPES.has(envelope.scope)) {
    throw new Error(`Context envelope ${envelope.id} has an unrecognized scope.`);
  }
  if (typeof envelope.source !== "string" || envelope.source.trim() === "") {
    throw new Error(`Context envelope ${envelope.id} requires a non-empty source.`);
  }
  if (!isValidOptionalTimestamp(envelope.capturedAt) || !isValidOptionalTimestamp(envelope.staleAfter)) {
    throw new Error(`Context envelope ${envelope.id} has an invalid capturedAt/staleAfter timestamp.`);
  }
  if (containsControlChars(envelope.content)) {
    throw new Error(`Context envelope ${envelope.id} contains unsupported control characters.`);
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
