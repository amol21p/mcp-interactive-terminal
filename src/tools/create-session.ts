import { z } from "zod";
import type { SessionManager } from "../session-manager.js";
import type { ServerConfig, CreateSessionOutput } from "../types.js";

export const createSessionSchema = z.object({
  command: z.string().describe("The command to spawn (e.g., 'python3', 'bash', 'psql')"),
  args: z.array(z.string()).optional().describe("Arguments to pass to the command"),
  name: z.string().optional().describe("Human-readable session name"),
  cwd: z.string().optional().describe("Working directory for the session"),
  env: z.record(z.string()).optional().describe("Additional environment variables"),
  cols: z.number().min(40).max(300).optional().default(120).describe("Terminal width in columns"),
  rows: z.number().min(10).max(100).optional().default(40).describe("Terminal height in rows"),
});

export type CreateSessionArgs = z.infer<typeof createSessionSchema>;

export async function handleCreateSession(
  args: CreateSessionArgs,
  sessionManager: SessionManager,
  config: ServerConfig,
): Promise<CreateSessionOutput> {
  if (config.logInputs) {
    console.error(`[mcp-terminal] create_session: ${args.command} ${(args.args ?? []).join(" ")}`);
  }

  const session = await sessionManager.createSession({
    command: args.command,
    args: args.args,
    name: args.name,
    cwd: args.cwd,
    env: args.env,
    cols: args.cols,
    rows: args.rows,
  });

  return {
    session_id: session.id,
    name: session.name,
    pid: session.pid,
  };
}
