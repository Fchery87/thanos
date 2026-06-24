import { describe, expect, it, afterEach } from "vitest";
import { yoloDisabledByEnv } from "../../src/permissions/yolo-config";

afterEach(() => { delete process.env.THANOS_YOLO_DISABLED; });

describe("yoloDisabledByEnv", () => {
  it("is true when THANOS_YOLO_DISABLED=1", () => {
    process.env.THANOS_YOLO_DISABLED = "1";
    expect(yoloDisabledByEnv()).toBe(true);
  });
  it("is false when unset", () => {
    expect(yoloDisabledByEnv()).toBe(false);
  });
});
