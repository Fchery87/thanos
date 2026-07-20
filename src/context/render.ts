import type { ContextEnvelope } from "./envelope";

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function escapeContent(content: string): string {
  return JSON.stringify(content);
}

export function renderContextEnvelope(envelope: ContextEnvelope): string {
  if (CONTROL_CHARS.test(envelope.content)) {
    throw new Error(`Context envelope ${envelope.id} contains unsupported control characters.`);
  }
  const encoded = escapeContent(envelope.content);
  if (Buffer.byteLength(encoded, "utf8") > envelope.maxBytes) {
    throw new Error(`Context envelope ${envelope.id} exceeds the byte budget.`);
  }
  return [
    `id:${envelope.id}`,
    `origin:${envelope.origin}`,
    `authority:${envelope.authority}`,
    `trusted:${envelope.trusted ? "true" : "false"}`,
    `content:${encoded}`,
  ].join("\n");
}
