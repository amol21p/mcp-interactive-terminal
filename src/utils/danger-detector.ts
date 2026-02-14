/**
 * Dangerous command pattern detection.
 * Returns a reason string if dangerous, null if safe.
 */

interface DangerPattern {
  pattern: RegExp;
  reason: string;
}

const DANGER_PATTERNS: DangerPattern[] = [
  // Destructive file operations
  { pattern: /\brm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+|.*-[a-zA-Z]*r[a-zA-Z]*f)/, reason: "Recursive force delete (rm -rf)" },
  { pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/(?!\S*tmp\b)/, reason: "Recursive delete from root" },
  { pattern: /\bmkfs\b/, reason: "Filesystem format" },
  { pattern: /\bdd\s+.*of=\/dev\//, reason: "Direct device write (dd)" },
  { pattern: />\s*\/dev\/sd[a-z]/, reason: "Direct write to disk device" },

  // SQL destructive operations
  { pattern: /\bDROP\s+(TABLE|DATABASE|SCHEMA)\b/i, reason: "SQL DROP operation" },
  { pattern: /\bTRUNCATE\s+TABLE\b/i, reason: "SQL TRUNCATE TABLE" },
  { pattern: /\bDELETE\s+FROM\s+\S+\s*(;|$)/i, reason: "SQL DELETE without WHERE clause" },

  // Network piping
  { pattern: /\bcurl\b.*\|\s*(ba)?sh\b/, reason: "Pipe remote content to shell (curl|sh)" },
  { pattern: /\bwget\b.*\|\s*(ba)?sh\b/, reason: "Pipe remote content to shell (wget|sh)" },
  { pattern: /\bcurl\b.*\|\s*sudo\b/, reason: "Pipe remote content to sudo" },

  // System modification
  { pattern: /\bchmod\s+(-[a-zA-Z]*\s+)?[0-7]*777\b/, reason: "chmod 777 (world-writable)" },
  { pattern: /\bchown\s+-R\s+.*\s+\/(?!tmp\b|home\b)/, reason: "Recursive chown from root" },

  // Process/service management
  { pattern: /\bsystemctl\s+(stop|disable|mask)\b/, reason: "Stopping/disabling system service" },
  { pattern: /\bkillall\b/, reason: "Kill all processes by name" },
  { pattern: /\bkill\s+-9\b/, reason: "Force kill (SIGKILL)" },

  // Disk/partition operations
  { pattern: /\bfdisk\b/, reason: "Disk partition modification" },
  { pattern: /\bparted\b/, reason: "Disk partition modification" },

  // Dangerous shell patterns
  { pattern: /:\(\)\s*\{[^}]*:\s*\|\s*:.*\}/, reason: "Fork bomb" },
  { pattern: />\s*\/etc\//, reason: "Overwriting system config" },
  { pattern: /\bsudo\s+rm\b/, reason: "Privileged delete" },
];

/**
 * Check if an input string contains dangerous patterns.
 * Returns the reason if dangerous, null if safe.
 */
export function detectDanger(input: string): string | null {
  for (const { pattern, reason } of DANGER_PATTERNS) {
    if (pattern.test(input)) {
      return reason;
    }
  }
  return null;
}

/**
 * Get all matching danger reasons for an input.
 */
export function detectAllDangers(input: string): string[] {
  const reasons: string[] = [];
  for (const { pattern, reason } of DANGER_PATTERNS) {
    if (pattern.test(input)) {
      reasons.push(reason);
    }
  }
  return reasons;
}
