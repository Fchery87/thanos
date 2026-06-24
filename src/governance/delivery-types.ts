import { type Static, type TSchema, Type } from "typebox";
import { Value } from "typebox/value";

// ── Shared literal unions ─────────────────────────────────────────────────────

export const Mode = Type.Union([
  Type.Literal("local-only"),
  Type.Literal("direct-PR"),
  Type.Literal("no-mistakes"),
]);

export const Autonomy = Type.Union([
  Type.Literal("attended"),
  Type.Literal("unattended"),
]);

// ── Captain registry (trusted: ~/.pi/agent/projects.json) ─────────────────────

export const RegistrySchema = Type.Object({
  version: Type.Literal(1),
  yolo: Type.Optional(Type.Literal("disabled")),
  default: Type.Object({
    mode: Mode,
    autonomy: Autonomy,
  }),
  projects: Type.Array(
    Type.Object({
      match: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      mode: Mode,
      autonomy: Autonomy,
      yolo: Type.Optional(
        Type.Union([Type.Literal("locked"), Type.Literal("inherit")]),
      ),
    }),
  ),
});

// ── Ship file (untrusted: repo-committed .thanos/delivery.json) ───────────────

export const ShipSchema = Type.Object({
  version: Type.Literal(1),
  gates: Type.Record(Type.String(), Type.Union([Type.String(), Type.Null()])),
  defaultBranch: Type.Optional(Type.String()),
  merge: Type.Optional(
    Type.Union([Type.Literal("fast-forward"), Type.Literal("pr")]),
  ),
});

export type Registry = Static<typeof RegistrySchema>;
export type ShipFile = Static<typeof ShipSchema>;

// ── Parsers ───────────────────────────────────────────────────────────────────
// Validate against the schema and throw on invalid (mirrors src/policy/schema.ts's
// throw-on-invalid contract), returning the typed value on success.

function firstError(schema: TSchema, input: unknown): string {
  const [error] = Value.Errors(schema, input);
  if (!error) return "invalid input";
  const at = error.instancePath || "/";
  return `${at}: ${error.message}`;
}

export function parseRegistry(input: unknown): Registry {
  if (!Value.Check(RegistrySchema, input)) {
    throw new Error(`Invalid delivery registry: ${firstError(RegistrySchema, input)}`);
  }
  return input;
}

export function parseShipFile(input: unknown): ShipFile {
  if (!Value.Check(ShipSchema, input)) {
    throw new Error(`Invalid ship file: ${firstError(ShipSchema, input)}`);
  }
  return input;
}
