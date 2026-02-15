import { z } from "zod";
import type { SessionManager } from "../session-manager.js";
import type { CloseSessionOutput } from "../types.js";
import { audit } from "../utils/audit-logger.js";

export const closeSessionSchema = z.object({
  session_id: z.string().describe("The session ID to close"),
  signal: z.string().optional().default("SIGTERM")
    .describe("Signal to send (e.g., SIGTERM, SIGKILL)"),
});

export type CloseSessionArgs = z.infer<typeof closeSessionSchema>;

export async function handleCloseSession(
  args: CloseSessionArgs,
  sessionManager: SessionManager,
): Promise<CloseSessionOutput> {
  audit("session_close", args.session_id, { signal: args.signal });
  sessionManager.closeSession(args.session_id, args.signal);
  return { success: true };
}
