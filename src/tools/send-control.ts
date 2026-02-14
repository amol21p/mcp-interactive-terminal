import { z } from "zod";
import type { SessionManager } from "../session-manager.js";
import type { ServerConfig, SendControlOutput } from "../types.js";
import { CONTROL_KEYS } from "../types.js";
import { sanitize } from "../utils/sanitizer.js";
import { redactSecrets } from "../utils/secret-redactor.js";

export const sendControlSchema = z.object({
  session_id: z.string().describe("The session ID"),
  control: z.string().describe(
    `Control sequence to send. Supported: ${Object.keys(CONTROL_KEYS).join(", ")}`
  ),
});

export type SendControlArgs = z.infer<typeof sendControlSchema>;

const CONTROL_WAIT_MS = 500;

export async function handleSendControl(
  args: SendControlArgs,
  sessionManager: SessionManager,
  config: ServerConfig,
): Promise<SendControlOutput> {
  if (config.logInputs) {
    console.error(`[mcp-terminal] send_control [${args.session_id}]: ${args.control}`);
  }

  const session = sessionManager.getSession(args.session_id);

  if (!session.isAlive) {
    throw new Error(`Session "${args.session_id}" is not alive`);
  }

  const key = args.control.toLowerCase();
  const sequence = CONTROL_KEYS[key];

  if (!sequence) {
    throw new Error(
      `Unknown control key "${args.control}". Supported: ${Object.keys(CONTROL_KEYS).join(", ")}`
    );
  }

  sessionManager.touchSession(args.session_id);

  session.terminal.write(sequence);

  // Brief wait for response
  await new Promise((resolve) => setTimeout(resolve, CONTROL_WAIT_MS));

  let output = session.terminal.readScreen();
  output = sanitize(output, { maxChars: config.maxOutput });

  if (config.redactSecrets) {
    output = redactSecrets(output);
  }

  return { output };
}
