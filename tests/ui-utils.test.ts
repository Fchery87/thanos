import { describe, expect, it } from "vitest";
import * as ui from "../src/ui-utils";
import { noopTheme, stripAnsi } from "../src/ui-utils";

describe("terminal-safe UI utilities", () => {
  it("keeps formatted panels within a terminal-safe visual width", () => {
    const panel = ui.formatPanel(noopTheme, "Very Long Panel", [
      `path: ${"nested-directory/".repeat(12)}file-with-a-long-name.ts`,
    ]);

    for (const line of panel.split("\n")) {
      expect(stripAnsi(line).length).toBeLessThanOrEqual(80);
    }
  });

  it("creates unique terminal-safe selector labels", () => {
    const makeSafeOptions = (ui as {
      makeTerminalSafeOptions?: (options: string[]) => string[];
    }).makeTerminalSafeOptions;

    expect(makeSafeOptions).toBeTypeOf("function");

    const options = [
      `provider/${"same-long-model-name-".repeat(5)}alpha`,
      `provider/${"same-long-model-name-".repeat(5)}beta`,
    ];
    const labels = makeSafeOptions?.(options) ?? [];

    expect(labels).toHaveLength(options.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) {
      expect(stripAnsi(label).length).toBeLessThanOrEqual(72);
    }
  });
});
