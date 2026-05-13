export interface SecretMatch {
  type: string;
  line: number;
  preview: string;
}

export interface ScanResult {
  found: boolean;
  matches: SecretMatch[];
}

const SECRET_PATTERNS: Array<{ type: string; re: RegExp }> = [
  { type: "AWS Access Key", re: /AKIA[0-9A-Z]{16}/ },
  { type: "AWS Secret Key", re: /aws_secret_access_key\s*[=:]\s*\S{40}/i },
  { type: "Private Key Block", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { type: "GitHub Token", re: /ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}/ },
  { type: "Stripe Secret Key", re: /sk_live_[0-9a-zA-Z]{24}/ },
  { type: "Slack Token", re: /xox[baprs]-[0-9A-Za-z\-]{10,}/ },
  { type: "Generic API Key", re: /(?:api[_-]?key|api[_-]?token|access[_-]?token|auth[_-]?token)\s*[=:]\s*["']?[A-Za-z0-9_\-]{20,}["']?/i },
  { type: "Password Assignment", re: /(?:password|passwd|pwd)\s*[=:]\s*["'][^"'\s]{6,}["']/i },
  { type: "Generic Secret", re: /(?:^|[^a-z])(?:secret|bearer)\s*[=:]\s*["'][A-Za-z0-9+/=]{20,}["']/i },
];

export function scanContent(content: string): ScanResult {
  const lines = content.split("\n");
  const matches: SecretMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { type, re } of SECRET_PATTERNS) {
      if (re.test(line)) {
        matches.push({ type, line: i + 1, preview: line.trim().slice(0, 60) });
        break;
      }
    }
  }
  return { found: matches.length > 0, matches };
}

export function formatScanResult(matches: SecretMatch[]): string {
  const shown = matches.slice(0, 5).map((m) => `  line ${m.line}: [${m.type}] ${m.preview}`);
  if (matches.length > 5) shown.push(`  … and ${matches.length - 5} more`);
  return shown.join("\n");
}
