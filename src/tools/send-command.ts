import { z } from "zod";
import { resolve as resolvePath } from "node:path";
import type { SessionManager } from "../session-manager.js";
import type { ServerConfig, SendCommandOutput } from "../types.js";
import { sanitize } from "../utils/sanitizer.js";
import { detectDanger } from "../utils/danger-detector.js";
import { redactSecrets } from "../utils/secret-redactor.js";
import { audit } from "../utils/audit-logger.js";

/**
 * Extract absolute paths from a command string and check them against allowed paths.
 * Returns the first disallowed path, or null if all are allowed.
 */
function findDisallowedPath(input: string, sessionManager: SessionManager): string | null {
  // Match absolute paths (Unix-style)
  const pathPattern = /(?:^|\s|=|"|')(\/{1,2}[\w./-]+)/g;
  let match;
  while ((match = pathPattern.exec(input)) !== null) {
    const p = match[1];
    // Skip common safe references that aren't filesystem writes
    if (p === "/dev/null" || p === "/dev/stdin" || p === "/dev/stdout" || p === "/dev/stderr") continue;
    if (!sessionManager.isPathAllowed(p)) {
      return p;
    }
  }
  // Also check for cd commands that try to escape
  const cdPattern = /\bcd\s+([^\s;|&]+)/g;
  while ((match = cdPattern.exec(input)) !== null) {
    const target = match[1];
    if (target.startsWith("/") && !sessionManager.isPathAllowed(target)) {
      return target;
    }
  }
  return null;
}

export const sendCommandSchema = z.object({
  session_id: z.string().describe("The session ID to send input to"),
  input: z.string().describe("The command/input to send (newline appended automatically)"),
  timeout_ms: z.number().min(100).max(60000).optional().default(5000)
    .describe("Max time to wait for output (ms)"),
  max_output_chars: z.number().min(100).optional()
    .describe("Override max output characters for this call"),
});

export type SendCommandArgs = z.infer<typeof sendCommandSchema>;

export async function handleSendCommand(
  args: SendCommandArgs,
  sessionManager: SessionManager,
  config: ServerConfig,
): Promise<SendCommandOutput> {
  if (config.logInputs) {
    console.error(`[mcp-terminal] send_command [${args.session_id}]: ${args.input}`);
  }

  const session = sessionManager.getSession(args.session_id);

  if (!session.isAlive) {
    throw new Error(`Session "${args.session_id}" is not alive`);
  }

  // Check for dangerous patterns
  if (config.dangerDetection) {
    const danger = detectDanger(args.input);
    if (danger) {
      // Check if this command was pre-confirmed
      const confirmKey = args.input.trim();
      if (session.pendingDangerousCommands.has(confirmKey)) {
        session.pendingDangerousCommands.delete(confirmKey);
        // Fall through — command was confirmed
      } else {
        audit("command_blocked_danger", args.session_id, { input: args.input, reason: danger });
        throw new Error(
          `Dangerous command detected: ${danger}. ` +
          `Use the confirm_dangerous_command tool first with a justification.`
        );
      }
    }
  }

  // Check for paths outside allowed set
  if (config.allowedPaths.length > 0) {
    const disallowed = findDisallowedPath(args.input, sessionManager);
    if (disallowed) {
      audit("command_blocked_path", args.session_id, { input: args.input, path: disallowed });
      throw new Error(
        `Path "${disallowed}" is outside the allowed paths: ${config.allowedPaths.join(", ")}. ` +
        `Commands can only reference paths within allowed directories.`
      );
    }
  }

  audit("command", args.session_id, { input: args.input });
  sessionManager.touchSession(args.session_id);

  // Write input with newline
  session.terminal.write(args.input + "\n");

  // Wait for output
  const { output, isComplete } = await session.terminal.waitForOutput(args.timeout_ms);

  // Sanitize
  const maxChars = args.max_output_chars ?? config.maxOutput;
  let cleanOutput = sanitize(output, {
    command: args.input,
    maxChars,
  });

  // Optional secret redaction
  if (config.redactSecrets) {
    cleanOutput = redactSecrets(cleanOutput);
  }

  const result: SendCommandOutput = {
    output: cleanOutput,
    is_complete: isComplete,
    is_alive: session.terminal.isAlive,
  };

  if (!isComplete) {
    result.warning = "Command may still be running. Use read_output to check for more output, or send_control to send ctrl+c.";
  }

  return result;
}
