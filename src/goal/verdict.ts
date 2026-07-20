import type { Verdict } from "./types";
import { parseExactEvaluatorVerdict } from "../evaluation/verdict-schema";

export function parseVerdict(text: string): Verdict {
  return parseExactEvaluatorVerdict(text);
}
