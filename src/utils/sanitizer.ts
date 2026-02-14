/**
 * Output sanitizer — cleans terminal output for AI consumption.
 * Since we use xterm-headless for rendering, most ANSI codes are already
 * handled. This module does final cleanup.
 */

/**
 * Strip any remaining ANSI escape sequences that xterm didn't consume.
 */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")     // OSC sequences
    .replace(/\x1b\(B/g, "")                  // Character set selection
    .replace(/\x1b/g, "");                     // Lone escapes
}

/**
 * Remove trailing whitespace from each line and collapse excessive blank lines.
 */
export function cleanWhitespace(text: string): string {
  const lines = text.split("\n").map((line) => line.trimEnd());

  // Collapse 2+ consecutive blank lines into 1
  const result: string[] = [];
  let blankCount = 0;
  for (const line of lines) {
    if (line === "") {
      blankCount++;
      if (blankCount <= 1) result.push(line);
    } else {
      blankCount = 0;
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * Strip the echoed command from the beginning of output.
 * Terminals typically echo what was typed — this wastes tokens.
 */
export function stripCommandEcho(output: string, command: string): string {
  const lines = output.split("\n");
  const trimmedCmd = command.trim();
  if (lines.length > 0 && lines[0].trim() === trimmedCmd) {
    return lines.slice(1).join("\n");
  }
  // Also handle prompt-prefixed echo: ">>> print('hi')" when command is "print('hi')"
  if (lines.length > 0 && lines[0].trimEnd().endsWith(trimmedCmd)) {
    return lines.slice(1).join("\n");
  }
  return output;
}

/**
 * Truncate output to a maximum number of characters.
 * If truncated, appends a notice.
 */
export function truncateOutput(output: string, maxChars: number): string {
  if (output.length <= maxChars) return output;
  const truncated = output.slice(0, maxChars);
  // Try to break at a newline for cleaner output
  const lastNewline = truncated.lastIndexOf("\n");
  const breakPoint = lastNewline > maxChars * 0.8 ? lastNewline : maxChars;
  return truncated.slice(0, breakPoint) + "\n\n... [output truncated at " + breakPoint + " chars]";
}

/**
 * Full sanitization pipeline.
 */
export function sanitize(
  output: string,
  options: {
    command?: string;
    maxChars?: number;
  } = {}
): string {
  let result = stripAnsi(output);
  if (options.command) {
    result = stripCommandEcho(result, options.command);
  }
  result = cleanWhitespace(result);
  if (options.maxChars) {
    result = truncateOutput(result, options.maxChars);
  }
  // Trim leading/trailing blank lines
  result = result.replace(/^\n+/, "").replace(/\n+$/, "");
  return result;
}
