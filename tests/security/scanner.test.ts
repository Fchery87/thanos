import { describe, expect, it } from "vitest";
import { scanContent, formatScanResult } from "../../src/security/scanner";

describe("scanContent", () => {
  it("returns not found for clean content", () => {
    const result = scanContent("const x = 1;\nconsole.log(x);");
    expect(result.found).toBe(false);
    expect(result.matches).toHaveLength(0);
  });

  it("detects AWS access key", () => {
    const result = scanContent("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");
    expect(result.found).toBe(true);
    expect(result.matches[0]?.type).toBe("AWS Access Key");
    expect(result.matches[0]?.line).toBe(1);
  });

  it("detects AWS secret key assignment", () => {
    const result = scanContent("aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY!!");
    expect(result.found).toBe(true);
    expect(result.matches[0]?.type).toBe("AWS Secret Key");
  });

  it("detects PEM private key block", () => {
    const result = scanContent("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...");
    expect(result.found).toBe(true);
    expect(result.matches[0]?.type).toBe("Private Key Block");
  });

  it("detects GitHub personal access token", () => {
    const result = scanContent("token: ghp_A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8");
    expect(result.found).toBe(true);
    expect(result.matches[0]?.type).toBe("GitHub Token");
  });

  it("detects Stripe secret key", () => {
    // Split to avoid triggering repository secret scanning on the test file itself
    const fakeKey = ["sk", "live", "AbCdEfGhIjKlMnOpQrStUvWx"].join("_");
    const result = scanContent(`STRIPE_KEY=${fakeKey}`);
    expect(result.found).toBe(true);
    expect(result.matches[0]?.type).toBe("Stripe Secret Key");
  });

  it("detects generic API key assignment", () => {
    const result = scanContent('api_key = "abc123xyz456def789ghi012jkl345mno"');
    expect(result.found).toBe(true);
    expect(result.matches[0]?.type).toBe("Generic API Key");
  });

  it("detects password assignment in quotes", () => {
    const result = scanContent('password = "super-secret-value"');
    expect(result.found).toBe(true);
    expect(result.matches[0]?.type).toBe("Password Assignment");
  });

  it("reports correct line numbers across multiline content", () => {
    const content = "const a = 1;\nconst b = 2;\nAKIAIOSFODNN7EXAMPLE = true;";
    const result = scanContent(content);
    expect(result.found).toBe(true);
    expect(result.matches[0]?.line).toBe(3);
  });

  it("reports at most one match per line", () => {
    const line = "AKIAIOSFODNN7EXAMPLE api_key=abc123xyz456def789ghi012jkl345mno";
    const result = scanContent(line);
    expect(result.matches).toHaveLength(1);
  });

  it("detects secrets across multiple lines independently", () => {
    const content = "AKIAIOSFODNN7EXAMPLE\npass=nope\npassword=\"realpassword\"";
    const result = scanContent(content);
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe("formatScanResult", () => {
  it("formats matches with line numbers and type", () => {
    const matches = [{ type: "AWS Access Key", line: 3, preview: "AKIAIOSFODNN7EXAMPLE" }];
    const output = formatScanResult(matches);
    expect(output).toContain("line 3");
    expect(output).toContain("AWS Access Key");
    expect(output).toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("caps display at 5 and adds overflow notice", () => {
    const matches = Array.from({ length: 8 }, (_, i) => ({
      type: "Generic API Key", line: i + 1, preview: "key=abc123xyz456def789ghi012jkl345mno",
    }));
    const output = formatScanResult(matches);
    expect(output).toContain("… and 3 more");
  });
});
