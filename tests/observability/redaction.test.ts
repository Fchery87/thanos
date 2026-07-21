import { describe, expect, it } from "vitest";
import { redactSensitive, redactSummary, redactUrl } from "../../src/observability/redaction";

describe("redactSensitive", () => {
  it("redacts bearer tokens", () => {
    const input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = redactSensitive(input);
    expect(result).not.toContain("eyJ");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts AWS access keys", () => {
    const input = "AKIAIOSFODNN7EXAMPLE";
    const result = redactSensitive(input);
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result).toContain("[AWS_KEY_REDACTED]");
  });

  it("redacts GitHub tokens", () => {
    const input = "ghp_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8";
    const result = redactSensitive(input);
    expect(result).not.toContain("ghp_");
    expect(result).toContain("[GITHUB_TOKEN_REDACTED]");
  });

  it("redacts Stripe live keys", () => {
    const fakeKey = ["sk", "live", "AbCdEfGhIjKlMnOpQrStUvWx"].join("_");
    const result = redactSensitive(fakeKey);
    expect(result).not.toContain("sk_live_");
    expect(result).toContain("[STRIPE_KEY_REDACTED]");
  });

  it("redacts API key assignments", () => {
    const input = 'api_key = "abc123xyz456def789ghi012jkl345mno"';
    const result = redactSensitive(input);
    expect(result).not.toContain("abc123xyz");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts password assignments", () => {
    const input = 'password = "super-secret-value"';
    const result = redactSensitive(input);
    expect(result).not.toContain("super-secret");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts private key blocks", () => {
    const input = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA...
-----END RSA PRIVATE KEY-----`;
    const result = redactSensitive(input);
    expect(result).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(result).toContain("[PRIVATE_KEY_BLOCK_REDACTED]");
  });

  it("redacts signed URL query parameters", () => {
    const input = "https://api.example.com/data?signature=abcdef123456&other=value";
    const result = redactSensitive(input);
    expect(result).not.toContain("abcdef123456");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts env var secrets", () => {
    const input = "export API_KEY=sk-secret-value-here";
    const result = redactSensitive(input);
    expect(result).not.toContain("sk-secret");
    expect(result).toContain("[REDACTED]");
  });

  it("redacts Slack tokens", () => {
    const input = ["xoxb", "123456789012", "123456789012", "abcdefghijklmnopqrstuvwx"].join("-");
    const result = redactSensitive(input);
    expect(result).not.toContain("xoxb-");
    expect(result).toContain("[SLACK_TOKEN_REDACTED]");
  });

  it("leaves non-secret content untouched", () => {
    const input = "const x = 1;\nconsole.log(x);\n// regular comment";
    const result = redactSensitive(input);
    expect(result).toBe(input);
  });

  it("is idempotent", () => {
    const input = "Bearer abc.def.ghi";
    const first = redactSensitive(input);
    const second = redactSensitive(first);
    expect(second).toBe(first);
  });
});

describe("redactSummary", () => {
  it("redacts and truncates long content", () => {
    const longContent = "Bearer " + "x".repeat(600);
    const result = redactSummary(longContent, 200);
    expect(result.length).toBeLessThanOrEqual(200);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("x".repeat(600));
  });

  it("preserves content under maxLength", () => {
    const result = redactSummary("short message", 500);
    expect(result).toBe("short message");
  });
});

describe("redactUrl", () => {
  it("redacts sensitive query params while keeping host", () => {
    const result = redactUrl("https://api.example.com/data?token=secret123&page=1");
    expect(result).toContain("api.example.com");
    expect(result).not.toContain("secret123");
    expect(result).toContain("REDACTED");
    expect(result).toContain("page=1");
  });

  it("redacts URL password", () => {
    const result = redactUrl("https://user:password123@example.com");
    expect(result).not.toContain("password123");
    expect(result).toContain("REDACTED");
  });

  it("returns redacted string for unparseable URLs", () => {
    const result = redactUrl("not-a-url but has api_key=my_super_secret_key_that_is_long_enough");
    expect(result).toContain("REDACTED");
  });
});
