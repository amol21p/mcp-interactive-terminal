import { z } from "zod";
import { execSync } from "node:child_process";
import type { SessionManager } from "../session-manager.js";
import type { ServerConfig, SendControlOutput } from "../types.js";
import { CONTROL_KEYS } from "../types.js";
import { sanitize } from "../utils/sanitizer.js";
import { redactSecrets } from "../utils/secret-redactor.js";
import { audit } from "../utils/audit-logger.js";

/**
 * Get all descendant PIDs of a process (children, grandchildren, etc.).
 * Works on macOS and Linux via pgrep.
 */
function getDescendantPids(pid: number): number[] {
  try {
    const out = execSync(`pgrep -P ${pid}`, { encoding: "utf-8", timeout: 2000 }).trim();
    if (!out) return [];
    const children = out.split("\n").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
    const descendants = [...children];
    for (const child of children) {
      descendants.push(...getDescendantPids(child));
    }
    return descendants;
  } catch {
    return []; // pgrep returns exit code 1 if no matches
  }
}

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

  audit("control", args.session_id, { control: key });
  sessionManager.touchSession(args.session_id);

  // In pipe mode, certain control keys need special handling
  if (session.terminal.mode === "pipe") {
    if (key === "ctrl+d") {
      // EOF — close stdin
      const proc = session.terminal.process as import("node:child_process").ChildProcess;
      proc.stdin?.end();
    } else if (key === "ctrl+c" || key === "ctrl+\\" || key === "ctrl+z") {
      // Send signal to all descendant processes (deepest-first), then the shell itself
      const signalMap: Record<string, NodeJS.Signals> = {
        "ctrl+c": "SIGINT",
        "ctrl+\\": "SIGQUIT",
        "ctrl+z": "SIGTSTP",
      };
      const sig = signalMap[key];
      const descendants = getDescendantPids(session.terminal.pid);
      // Signal deepest descendants first (reverse order)
      for (const dpid of descendants.reverse()) {
        try { process.kill(dpid, sig); } catch { /* already exited */ }
      }
      // Also signal the shell process itself
      try { process.kill(session.terminal.pid, sig); } catch { /* ignore */ }
    } else {
      session.terminal.write(sequence);
    }
  } else {
    session.terminal.write(sequence);
  }

  // Brief wait for response
  await new Promise((resolve) => setTimeout(resolve, CONTROL_WAIT_MS));

  let output = session.terminal.readScreen();
  output = sanitize(output, { maxChars: config.maxOutput });

  if (config.redactSecrets) {
    output = redactSecrets(output);
  }

  return { output };
}
