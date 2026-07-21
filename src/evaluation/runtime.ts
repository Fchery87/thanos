export interface EvaluatorRunOptions {
  timeoutMs?: number;
  maxOutputBytes?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
}

export interface EvaluatorRunResult {
  verdict: string;
  rawOutput: string;
  attempts: number;
  fallbackUsed: boolean;
  fallbackReason?: string;
  model?: string;
  provider?: string;
  latencyMs: number;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

interface EvaluatorOutput {
  text: string;
  model?: string;
  provider?: string;
  tokenUsage?: { input: number; output: number };
}

type CompleteFn = () => Promise<EvaluatorOutput>;

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_BYTES = 32 * 1024;
const DEFAULT_MAX_ATTEMPTS = 2;

const FALLBACK_VERDICT = "NEEDS_WORK (evaluator failed, no usable output)";

export async function runEvaluator(
  complete: CompleteFn,
  opts: EvaluatorRunOptions = {},
): Promise<EvaluatorRunResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  if (opts.signal?.aborted) {
    return {
      verdict: FALLBACK_VERDICT,
      rawOutput: "",
      attempts: 0,
      fallbackUsed: true,
      fallbackReason: "aborted",
      latencyMs: 0,
    };
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      return {
        verdict: FALLBACK_VERDICT,
        rawOutput: "",
        attempts: attempt,
        fallbackUsed: true,
        fallbackReason: "aborted",
        latencyMs: 0,
      };
    }

    const startedAt = Date.now();

    let timedOut = false;
    let abortHandler: (() => void) | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      const id = setTimeout(() => {
        timedOut = true;
        reject(new Error(`evaluator timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      abortHandler = () => clearTimeout(id);
    });

    try {
      const result = await Promise.race([
        complete(),
        timeoutPromise,
      ]);

      abortHandler?.();
      const latencyMs = Date.now() - startedAt;

      if (timedOut) continue;

      const boundedText = result.text.slice(0, maxOutputBytes);
      const verdict = parseVerdictFromText(boundedText);

      return {
        verdict,
        rawOutput: boundedText,
        attempts: attempt + 1,
        fallbackUsed: false,
        model: result.model,
        provider: result.provider,
        latencyMs,
        tokenUsage: result.tokenUsage,
      };
    } catch (err) {
      abortHandler?.();
      if (opts.signal?.aborted) {
        return {
          verdict: FALLBACK_VERDICT,
          rawOutput: "",
          attempts: attempt + 1,
          fallbackUsed: true,
          fallbackReason: "aborted",
          latencyMs: Date.now() - startedAt,
        };
      }
      if (attempt < maxAttempts - 1) continue;
      return {
        verdict: FALLBACK_VERDICT,
        rawOutput: "",
        attempts: attempt + 1,
        fallbackUsed: true,
        fallbackReason: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  return {
    verdict: FALLBACK_VERDICT,
    rawOutput: "",
    attempts: maxAttempts,
    fallbackUsed: true,
    fallbackReason: "all attempts exhausted",
    latencyMs: 0,
  };
}

function parseVerdictFromText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return FALLBACK_VERDICT;

  const lines = trimmed.split("\n");
  const firstLine = (lines[0] ?? "").trim();
  if (/^(PASS|NEEDS_WORK|FAIL)\b/i.test(firstLine)) {
    return firstLine;
  }

  const passRe = /\bPASS\b/i.exec(trimmed);
  if (passRe) {
    const start = Math.max(0, passRe.index - 20);
    const end = Math.min(trimmed.length, passRe.index + passRe[0].length + 60);
    return trimmed.slice(start, end);
  }

  const needsWorkRe = /\bNEEDS_WORK\b/i.exec(trimmed);
  if (needsWorkRe) {
    const start = Math.max(0, needsWorkRe.index - 20);
    const end = Math.min(trimmed.length, needsWorkRe.index + needsWorkRe[0].length + 60);
    return trimmed.slice(start, end);
  }

  return FALLBACK_VERDICT;
}
