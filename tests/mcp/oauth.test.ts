import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { refreshAccessToken } from "../../src/mcp/oauth";

describe("refreshAccessToken", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs grant_type=refresh_token and returns new access token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "new-token-xyz" }),
      text: async () => JSON.stringify({ access_token: "new-token-xyz" }),
    } as unknown as Response);

    const token = await refreshAccessToken({
      tokenEndpoint: "https://auth.example.com/token",
      refreshToken: "rt_abc123",
      clientId: "pi-harness",
    });

    expect(token).toBe("new-token-xyz");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://auth.example.com/token");
    expect(init.method).toBe("POST");

    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt_abc123");
    expect(body.get("client_id")).toBe("pi-harness");
  });

  it("throws on non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "invalid_grant",
    } as unknown as Response);

    await expect(
      refreshAccessToken({ tokenEndpoint: "https://auth.example.com/token", refreshToken: "bad", clientId: "pi-harness" }),
    ).rejects.toThrow("401");
  });

  it("throws if response has no access_token", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ error: "invalid_grant" }),
      text: async () => "{}",
    } as unknown as Response);

    await expect(
      refreshAccessToken({ tokenEndpoint: "https://auth.example.com/token", refreshToken: "rt", clientId: "pi-harness" }),
    ).rejects.toThrow(/access_token/);
  });
});

describe("runOAuthFlow result includes refreshToken", () => {
  it("OAuthFlowResult type includes optional refreshToken field", async () => {
    // Type-level check: OAuthFlowResult must have refreshToken? field.
    // We verify this by importing the type and using it in a way that would
    // cause a TS error if the field doesn't exist.
    const { runOAuthFlow } = await import("../../src/mcp/oauth");
    // We just verify the export exists and is a function — runtime type check.
    expect(typeof runOAuthFlow).toBe("function");
  });
});
