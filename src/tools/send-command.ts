import { z } from "zod";
import type { SessionManager } from "../session-manager.js";
import type { ServerConfig, SendCommandOutput } from "../types.js";
import { sanitize } from "../utils/sanitizer.js";
import { detectDanger } from "../utils/danger-detector.js";
import { redactSecrets } from "../utils/secret-redactor.js";

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
        throw new Error(
          `Dangerous command detected: ${danger}. ` +
          `Use the confirm_dangerous_command tool first with a justification.`
        );
      }
    }
  }

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
