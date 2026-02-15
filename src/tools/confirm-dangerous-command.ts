import { z } from "zod";
import type { SessionManager } from "../session-manager.js";
import type { ServerConfig, ConfirmDangerousCommandOutput } from "../types.js";
import { sanitize } from "../utils/sanitizer.js";
import { detectDanger } from "../utils/danger-detector.js";
import { redactSecrets } from "../utils/secret-redactor.js";
import { audit } from "../utils/audit-logger.js";

export const confirmDangerousCommandSchema = z.object({
  session_id: z.string().describe("The session ID"),
  input: z.string().describe("The exact dangerous command to confirm and execute"),
  justification: z.string().min(10).describe(
    "Explanation of WHY this dangerous command is necessary (min 10 chars)"
  ),
});

export type ConfirmDangerousCommandArgs = z.infer<typeof confirmDangerousCommandSchema>;

export async function handleConfirmDangerousCommand(
  args: ConfirmDangerousCommandArgs,
  sessionManager: SessionManager,
  config: ServerConfig,
): Promise<ConfirmDangerousCommandOutput> {
  if (config.logInputs) {
    console.error(
      `[mcp-terminal] confirm_dangerous_command [${args.session_id}]: ${args.input} | justification: ${args.justification}`
    );
  }

  const session = sessionManager.getSession(args.session_id);

  if (!session.isAlive) {
    throw new Error(`Session "${args.session_id}" is not alive`);
  }

  // Verify the command is actually dangerous (prevent misuse as a bypass)
  const danger = detectDanger(args.input);
  if (!danger && config.dangerDetection) {
    throw new Error(
      "This command does not appear to be dangerous. Use send_command instead."
    );
  }

  audit("command_confirmed_danger", args.session_id, {
    input: args.input,
    reason: danger,
    justification: args.justification,
  });

  sessionManager.touchSession(args.session_id);

  // Execute the command
  session.terminal.write(args.input + "\n");

  // Wait for output with a longer default timeout for dangerous operations
  const { output, isComplete } = await session.terminal.waitForOutput(
    config.defaultTimeout * 2
  );

  const maxChars = config.maxOutput;
  let cleanOutput = sanitize(output, {
    command: args.input,
    maxChars,
  });

  if (config.redactSecrets) {
    cleanOutput = redactSecrets(cleanOutput);
  }

  return {
    output: cleanOutput,
    is_complete: isComplete,
    is_alive: session.terminal.isAlive,
  };
}
