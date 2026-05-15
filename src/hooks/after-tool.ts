import type { SpecEngine } from "../spec/engine";
import type { ToolResultEventLike } from "../spec/evidence";

export function makeAfterToolHandler(spec: SpecEngine) {
  return async (event: ToolResultEventLike): Promise<void> => {
    spec.recordToolResult(event);
  };
}
