import type { SpecEngine } from "../spec/engine";

export function makeAfterToolHandler(spec: SpecEngine) {
  return async (event: { toolName: string; output: string }): Promise<void> => {
    if (spec.activeSpec) {
      spec.collectOutput(event.output ?? "");
    }
  };
}
