/**
 * Smart "command done" detection.
 *
 * Layered strategy:
 * 1. Process exit — if process died, command is done
 * 2. Prompt detection — auto-detect prompt pattern, watch for reappearance
 * 3. Output settling — no new output for settling period
 * 4. Timeout — always returns after timeout_ms
 */

// Common prompt patterns for various shells/REPLs
const KNOWN_PROMPTS: RegExp[] = [
  // Bash/zsh: "$ ", "# ", "% "
  /[$#%>]\s*$/,
  // Python: ">>> ", "... "
  /^>{3}\s*$/,
  // Node.js: "> "
  /^>\s*$/,
  // Ruby/IRB: "irb(main):NNN:N> ", ">> "
  /^(irb\(.*\):\d+:\d+>|>>)\s*$/,
  // Rails console
  /^\d+\.\d+\.\d+\s*:?\d*\s*>\s*$/,
  // psql: "dbname=# ", "dbname=> "
  /^[a-zA-Z_][a-zA-Z0-9_-]*[=#]>\s*$/,
  // mysql: "mysql> "
  /^mysql>\s*$/,
  // sqlite: "sqlite> "
  /^sqlite>\s*$/,
  // Redis: "127.0.0.1:6379> "
  /^\d+\.\d+\.\d+\.\d+:\d+>\s*$/,
  // Generic "name> " pattern
  /^[a-zA-Z_][\w.-]*>\s*$/,
];

/**
 * Try to detect the prompt pattern from initial terminal output.
 * Looks at the last non-empty line of the startup text.
 */
export function detectPromptPattern(startupOutput: string): RegExp | null {
  const lines = startupOutput.split("\n");
  // Find the last non-empty line
  let lastLine = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 0) {
      lastLine = trimmed;
      break;
    }
  }

  if (!lastLine) return null;

  // Check against known prompt patterns
  for (const pattern of KNOWN_PROMPTS) {
    if (pattern.test(lastLine)) {
      // Create an escaped version of the exact prompt for matching
      const escaped = escapeRegex(lastLine);
      return new RegExp(escaped + "\\s*$");
    }
  }

  // Heuristic: if the last line is short (< 60 chars) and ends with a common
  // prompt character, treat it as a prompt
  if (lastLine.length < 60 && /[$#%>:]\s*$/.test(lastLine)) {
    const escaped = escapeRegex(lastLine);
    return new RegExp(escaped + "\\s*$");
  }

  return null;
}

/**
 * Check if output ends with a prompt, indicating command completion.
 */
export function endsWithPrompt(output: string, promptPattern: RegExp | null): boolean {
  if (!promptPattern) return false;

  const lines = output.split("\n");
  // Check the last few non-empty lines
  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
    const trimmed = lines[i].trim();
    if (trimmed.length > 0) {
      return promptPattern.test(trimmed);
    }
  }
  return false;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
