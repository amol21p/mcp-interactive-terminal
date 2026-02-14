import { z } from "zod";
import type { SessionManager } from "../session-manager.js";
import type { ServerConfig, ReadOutputOutput } from "../types.js";
import { sanitize } from "../utils/sanitizer.js";
import { redactSecrets } from "../utils/secret-redactor.js";

export const readOutputSchema = z.object({
  session_id: z.string().describe("The session ID to read output from"),
  full_screen: z.boolean().optional().default(false)
    .describe("Read full scrollback history instead of just the visible screen"),
});

export type ReadOutputArgs = z.infer<typeof readOutputSchema>;

export async function handleReadOutput(
  args: ReadOutputArgs,
  sessionManager: SessionManager,
  config: ServerConfig,
): Promise<ReadOutputOutput> {
  const session = sessionManager.getSession(args.session_id);

  let output = session.terminal.readScreen(args.full_screen);
  output = sanitize(output, { maxChars: config.maxOutput });

  if (config.redactSecrets) {
    output = redactSecrets(output);
  }

  return {
    output,
    is_alive: session.terminal.isAlive,
  };
}
