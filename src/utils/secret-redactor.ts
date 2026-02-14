/**
 * Secret redaction — detects and redacts sensitive values in output.
 * Opt-in via MCP_TERMINAL_REDACT_SECRETS=true.
 */

interface SecretPattern {
  pattern: RegExp;
  label: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // AWS
  { pattern: /\b(AKIA[0-9A-Z]{16})\b/g, label: "AWS_ACCESS_KEY" },
  { pattern: /\b([0-9a-zA-Z/+]{40})\b/g, label: "POSSIBLE_AWS_SECRET" },

  // GitHub
  { pattern: /\b(ghp_[0-9a-zA-Z]{36,})\b/g, label: "GITHUB_PAT" },
  { pattern: /\b(gho_[0-9a-zA-Z]{36,})\b/g, label: "GITHUB_OAUTH" },
  { pattern: /\b(ghs_[0-9a-zA-Z]{36,})\b/g, label: "GITHUB_APP" },

  // Generic API keys
  { pattern: /\b(sk-[0-9a-zA-Z]{20,})\b/g, label: "API_KEY" },
  { pattern: /\b(api[_-]?key\s*[:=]\s*['"]?)([0-9a-zA-Z_\-]{20,})/gi, label: "API_KEY" },

  // Private keys
  { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, label: "PRIVATE_KEY" },

  // Generic tokens
  { pattern: /\b(token\s*[:=]\s*['"]?)([0-9a-zA-Z_\-]{20,})/gi, label: "TOKEN" },

  // Connection strings with passwords
  { pattern: /:\/\/[^:]+:([^@]{8,})@/g, label: "PASSWORD_IN_URL" },
];

/**
 * Redact secrets from output text.
 * Returns the redacted text.
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const { pattern, label } of SECRET_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    result = result.replace(pattern, `[REDACTED:${label}]`);
  }
  return result;
}
