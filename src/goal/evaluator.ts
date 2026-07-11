import { buildEvaluatorContext, type EvaluatorInput } from "./prompts";
import { parseVerdict } from "./verdict";
import type { Verdict } from "./types";

type CompleteFn = (context: ReturnType<typeof buildEvaluatorContext>) => Promise<{
  content: { type: string; text?: string }[];
  stopReason?: string;
  errorMessage?: string;
}>;

/**
 * Pure core: context → completion → verdict. The wiring binds `complete` to
 * completeSimple(model, ctx, { reasoning: "low" }) with the model resolved
 * from the `evaluator` routing role, else the current session model.
 */
export async function runEvaluatorWith(complete: CompleteFn, input: EvaluatorInput): Promise<Verdict> {
  const context = buildEvaluatorContext(input);
  const message = await complete(context);
  // completeSimple resolves — never rejects — on API failures: the message
  // carries stopReason "error"/"aborted" plus errorMessage, with empty content.
  // Throw so the caller's fallback runs and the real error surfaces, instead of
  // parsing empty text into a meaningless "evaluator output unreadable" verdict.
  if (message.stopReason === "error" || message.stopReason === "aborted") {
    throw new Error(message.errorMessage ?? `evaluator completion ${message.stopReason}`);
  }
  const text = message.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
  return parseVerdict(text);
}
