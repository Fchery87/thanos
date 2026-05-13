import { describe, expect, it } from "vitest";
import { routeModel, formatRouteStatus, formatRouteNotice } from "../../src/models/router";

describe("routeModel", () => {
  it("routes instant to the cheapest model", () => {
    const route = routeModel("instant");
    expect(route.modelId).toBe("gemini-2.5-flash-lite");
    expect(route.inputCostPer1M).toBeLessThan(0.5);
  });

  it("routes ambient to a mid-tier model", () => {
    const route = routeModel("ambient");
    expect(route.modelId).toBe("gpt-5.4-mini");
    expect(route.inputCostPer1M).toBeGreaterThan(0.5);
    expect(route.inputCostPer1M).toBeLessThan(3);
  });

  it("routes explicit to the best model", () => {
    const route = routeModel("explicit");
    expect(route.modelId).toBe("gpt-5.5");
    expect(route.inputCostPer1M).toBeGreaterThanOrEqual(5);
    expect(route.reasoning).toBe(true);
  });

  it("routes maintain cost ordering: instant < ambient < explicit", () => {
    const instant = routeModel("instant");
    const ambient = routeModel("ambient");
    const explicit = routeModel("explicit");
    expect(instant.inputCostPer1M).toBeLessThan(ambient.inputCostPer1M);
    expect(ambient.inputCostPer1M).toBeLessThan(explicit.inputCostPer1M);
  });

  it("all routes include a rationale", () => {
    for (const tier of ["instant", "ambient", "explicit"] as const) {
      expect(routeModel(tier).rationale.length).toBeGreaterThan(0);
    }
  });

  it("all routes target the theclawbay provider", () => {
    for (const tier of ["instant", "ambient", "explicit"] as const) {
      expect(routeModel(tier).provider).toBe("theclawbay");
    }
  });
});

describe("formatRouteStatus", () => {
  it("includes model id and cost", () => {
    const status = formatRouteStatus(routeModel("instant"));
    expect(status).toContain("gemini-2.5-flash-lite");
    expect(status).toContain("0.1");
  });
});

describe("formatRouteNotice", () => {
  it("says 'Switched to' when switched is true", () => {
    const notice = formatRouteNotice("explicit", routeModel("explicit"), true);
    expect(notice).toContain("Switched to");
    expect(notice).toContain("GPT-5.5");
  });

  it("says 'Recommended' when switched is false", () => {
    const notice = formatRouteNotice("ambient", routeModel("ambient"), false);
    expect(notice).toContain("Recommended:");
  });
});
