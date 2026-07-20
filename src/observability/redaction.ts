const REDACT_PATTERNS: Array<{ name: string; re: RegExp; replacement: string }> = [
  { name: "bearer_token", re: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: "Bearer [REDACTED]" },
  { name: "basic_auth", re: /Basic\s+[A-Za-z0-9+/=]+/gi, replacement: "Basic [REDACTED]" },
  { name: "authorization_header", re: /Authorization:\s*[^\n\r]+/gi, replacement: "Authorization: [REDACTED]" },
  { name: "aws_key", re: /AKIA[0-9A-Z]{16}/g, replacement: "[AWS_KEY_REDACTED]" },
  { name: "aws_secret", re: /aws_secret_access_key\s*[=:]\s*\S{40}/gi, replacement: "aws_secret_access_key=[REDACTED]" },
  { name: "github_token", re: /ghp_[A-Za-z0-9]{36}/g, replacement: "[GITHUB_TOKEN_REDACTED]" },
  { name: "github_pat", re: /github_pat_[A-Za-z0-9_]{82}/g, replacement: "[GITHUB_PAT_REDACTED]" },
  { name: "stripe_live", re: /sk_live_[0-9a-zA-Z]{24}/g, replacement: "[STRIPE_KEY_REDACTED]" },
  { name: "stripe_test", re: /sk_test_[0-9a-zA-Z]{24}/g, replacement: "[STRIPE_KEY_REDACTED]" },
  { name: "slack_token", re: /xox[baprs]-[0-9A-Za-z\-]{10,}/g, replacement: "[SLACK_TOKEN_REDACTED]" },
  { name: "api_key_assignment", re: /(?:api[_-]?key|api[_-]?token|access[_-]?token|auth[_-]?token)\s*[=:]\s*["']?[A-Za-z0-9_\-]{20,}["']?/gi, replacement: "$1=[REDACTED]" },
  { name: "password_assignment", re: /(?:password|passwd|pwd)\s*[=:]\s*["'][^"'\s]{6,}["']/gi, replacement: "$1=[REDACTED]" },
  { name: "secret_assignment", re: /(?:^|[^a-z])(?:secret|bearer)\s*[=:]\s*["'][A-Za-z0-9+/=]{20,}["']/gi, replacement: " $1=[REDACTED]" },
  { name: "private_key_block", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g, replacement: "[PRIVATE_KEY_BLOCK_REDACTED]" },
  { name: "signed_url_query", re: /[?&](?:signature|sig|token|auth|key|secret|api_key|access_token)=[^&\s]+/gi, replacement: " $1=[REDACTED]" },
  { name: "env_var_secret", re: /(?:^|\n)\s*(?:export\s+)?([A-Z_]+(?:KEY|SECRET|TOKEN|PASSWORD|PASS|AUTH))\s*=\s*[^\n]+/gi, replacement: " $1=[REDACTED]" },
];

export function redactSensitive(input: string): string {
  let result = input;
  for (const { re, replacement } of REDACT_PATTERNS) {
    result = result.replace(re, replacement);
  }
  return result;
}

export function redactSummary(input: string, maxLength = 500): string {
  const redacted = redactSensitive(input);
  return redacted.length > maxLength ? redacted.slice(0, maxLength - 3) + "..." : redacted;
}

export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    let result = url;
    for (const param of ["token", "auth", "key", "secret", "api_key", "access_token", "signature", "sig", "password", "pass"]) {
      if (parsed.searchParams.has(param)) {
        result = result.replace(new RegExp(`([?&]${param}=)[^&]*`, "gi"), "$1REDACTED");
      }
    }
    if (parsed.password) {
      result = result.replace(new RegExp(`://[^:]*:${parsed.password}@`, "g"), "://$1:REDACTED@");
    }
    return result;
  } catch {
    return redactSensitive(url);
  }
}
