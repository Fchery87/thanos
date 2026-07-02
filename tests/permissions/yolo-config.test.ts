import { describe, expect, it, afterEach } from "vitest";
import { gateDisabledByEnv, yoloDisabledByEnv } from "../../src/permissions/yolo-config";

afterEach(() => {
  delete process.env.THANOS_VERIFY_GATE;
  delete process.env.THANOS_YOLO_DISABLED;
});

describe("yoloDisabledByEnv", () => {
  it("is true when THANOS_YOLO_DISABLED=1", () => {
    process.env.THANOS_YOLO_DISABLED = "1";
    expect(yoloDisabledByEnv()).toBe(true);
  });
  it("is false when unset", () => {
    expect(yoloDisabledByEnv()).toBe(false);
  });
  it("trims surrounding whitespace", () => {
    process.env.THANOS_YOLO_DISABLED = " 1 ";
    expect(yoloDisabledByEnv()).toBe(true);
  });
  it("treats non-\"1\" values as not disabled", () => {
    process.env.THANOS_YOLO_DISABLED = "0";
    expect(yoloDisabledByEnv()).toBe(false);
  });
});

describe("gateDisabledByEnv", () => {
  it("disables the verification gate when THANOS_VERIFY_GATE=off", () => {
    process.env.THANOS_VERIFY_GATE = " off ";
    expect(gateDisabledByEnv()).toBe(true);
  });

  it("keeps the verification gate enabled by default", () => {
    delete process.env.THANOS_VERIFY_GATE;
    expect(gateDisabledByEnv()).toBe(false);
  });
});
