import type { DelegationOutcome } from "../delegation/runtime";

/** Convert an unexpected delegate rejection into the existing typed outcome. */
export function normalizeDelegationFailure(error: unknown): Extract<DelegationOutcome, { state: "failed" }> {
  const reason = error instanceof Error && error.message.trim()
    ? error.message.trim()
    : typeof error === "string" && error.trim()
      ? error.trim()
      : "delegation failed unexpectedly";
  return { state: "failed", reason };
}
