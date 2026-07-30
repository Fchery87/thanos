export interface ScenarioEvent {
  type: string;
  atMs: number;
  data?: unknown;
}

export interface OutcomeTrace {
  name: string;
  outcome: "passed" | "failed";
  events: ScenarioEvent[];
  durationMs: number;
  artifactPaths: string[];
  error?: string;
}

export interface ScenarioContext {
  emit: (type: string, data?: unknown) => void;
  artifact: (path: string) => void;
}

export interface Scenario {
  name: string;
  execute: (ctx: ScenarioContext) => void | Promise<void>;
  assert: (trace: Omit<OutcomeTrace, "outcome" | "error">) => void | Promise<void>;
}

export async function runScenario(scenario: Scenario): Promise<OutcomeTrace> {
  const start = performance.now();
  const events: ScenarioEvent[] = [];
  const artifactPaths: string[] = [];
  const context: ScenarioContext = {
    emit: (type, data) => {
      events.push({
        type,
        atMs: performance.now() - start,
        ...(data === undefined ? {} : { data }),
      });
    },
    artifact: (path) => {
      if (!artifactPaths.includes(path)) artifactPaths.push(path);
    },
  };

  try {
    await scenario.execute(context);
    const trace = {
      name: scenario.name,
      events,
      durationMs: performance.now() - start,
      artifactPaths,
    };
    await scenario.assert(trace);
    return { ...trace, outcome: "passed" };
  } catch (error) {
    return {
      name: scenario.name,
      outcome: "failed",
      events,
      durationMs: performance.now() - start,
      artifactPaths,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
