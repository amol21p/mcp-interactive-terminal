/**
 * MCP Interactive Terminal Server
 *
 * Provides AI agents with interactive terminal sessions via the
 * Model Context Protocol. Supports REPLs, SSH, databases, and
 * any interactive CLI.
 *
 * NOTE: The CLI entry point is bin.ts (dist/bin.js), which performs
 * a Node version check before importing this module. If you import
 * this module directly, you are responsible for ensuring Node >= 18.14.1.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./types.js";
import { SessionManager } from "./session-manager.js";

import { createSessionSchema, handleCreateSession } from "./tools/create-session.js";
import { sendCommandSchema, handleSendCommand } from "./tools/send-command.js";
import { readOutputSchema, handleReadOutput } from "./tools/read-output.js";
import { handleListSessions } from "./tools/list-sessions.js";
import { closeSessionSchema, handleCloseSession } from "./tools/close-session.js";
import { sendControlSchema, handleSendControl } from "./tools/send-control.js";
import {
  confirmDangerousCommandSchema,
  handleConfirmDangerousCommand,
} from "./tools/confirm-dangerous-command.js";
import { initSandbox, resetSandbox } from "./sandbox.js";
import { configureAudit, audit } from "./utils/audit-logger.js";

const config = loadConfig();
const sessionManager = new SessionManager(config);

const server = new McpServer({
  name: "mcp-interactive-terminal",
  version: "1.0.0",
});

// --- Tool Registration ---

server.tool(
  "create_session",
  "Spawn an interactive terminal session (REPL, shell, database client, SSH, etc.). Returns a session_id for subsequent commands.",
  createSessionSchema.shape,
  { title: "Create Session", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async ({ command, args, name, cwd, env, cols, rows }) => {
    try {
      const result = await handleCreateSession(
        { command, args, name, cwd, env, cols, rows },
        sessionManager,
        config,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "send_command",
  "Send a command/input to an interactive session and wait for output. Appends newline automatically. Returns clean text output (no ANSI codes). If a dangerous command is detected, you must use confirm_dangerous_command first.",
  sendCommandSchema.shape,
  { title: "Send Command", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async ({ session_id, input, timeout_ms, max_output_chars }) => {
    try {
      const result = await handleSendCommand(
        { session_id, input, timeout_ms, max_output_chars },
        sessionManager,
        config,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "read_output",
  "Read the current terminal screen without sending any input. Safe read-only operation.",
  readOutputSchema.shape,
  { title: "Read Output", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async ({ session_id, full_screen }) => {
    try {
      const result = await handleReadOutput(
        { session_id, full_screen },
        sessionManager,
        config,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "list_sessions",
  "List all active interactive terminal sessions. Safe read-only operation.",
  {},
  { title: "List Sessions", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async () => {
    try {
      const result = await handleListSessions(sessionManager);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "close_session",
  "Close/kill an interactive terminal session.",
  closeSessionSchema.shape,
  { title: "Close Session", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  async ({ session_id, signal }) => {
    try {
      const result = await handleCloseSession(
        { session_id, signal },
        sessionManager,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "send_control",
  "Send a control character or special key to a session (e.g., ctrl+c to interrupt, ctrl+d to send EOF, arrow keys, tab for completion).",
  sendControlSchema.shape,
  { title: "Send Control", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async ({ session_id, control }) => {
    try {
      const result = await handleSendControl(
        { session_id, control },
        sessionManager,
        config,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "confirm_dangerous_command",
  "Execute a command that was flagged as dangerous by send_command. Requires a justification explaining WHY the command is necessary. This is a separate confirmation step for safety.",
  confirmDangerousCommandSchema.shape,
  { title: "Confirm Dangerous Command", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  async ({ session_id, input, justification }) => {
    try {
      const result = await handleConfirmDangerousCommand(
        { session_id, input, justification },
        sessionManager,
        config,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  },
);

// --- Lifecycle ---

async function main() {
  const transport = new StdioServerTransport();

  // Initialize audit logger
  if (config.auditLog) {
    configureAudit(config.auditLog);
  }

  // Initialize sandbox if enabled
  if (config.sandbox) {
    await initSandbox(config);
  }

  // Cleanup on shutdown
  process.on("SIGINT", async () => {
    audit("server_stop");
    sessionManager.closeAll();
    await resetSandbox();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    audit("server_stop");
    sessionManager.closeAll();
    await resetSandbox();
    process.exit(0);
  });

  console.error(`[mcp-terminal] Starting MCP Interactive Terminal Server`);
  console.error(`[mcp-terminal] Node ${process.versions.node} | ${process.platform} ${process.arch}`);
  console.error(`[mcp-terminal] Config: maxSessions=${config.maxSessions}, maxOutput=${config.maxOutput}, defaultTimeout=${config.defaultTimeout}ms`);

  if (config.dangerDetection) {
    console.error("[mcp-terminal] Dangerous command detection: ENABLED");
  }
  if (config.redactSecrets) {
    console.error("[mcp-terminal] Secret redaction: ENABLED");
  }
  if (config.blockedCommands.length > 0) {
    console.error(`[mcp-terminal] Blocked commands: ${config.blockedCommands.join(", ")}`);
  }
  if (config.allowedCommands.length > 0) {
    console.error(`[mcp-terminal] Allowed commands: ${config.allowedCommands.join(", ")}`);
  }
  if (config.allowedPaths.length > 0) {
    console.error(`[mcp-terminal] Allowed paths: ${config.allowedPaths.join(", ")}`);
  }
  if (config.auditLog) {
    console.error(`[mcp-terminal] Audit log: ${config.auditLog}`);
  }

  audit("server_start", undefined, {
    maxSessions: config.maxSessions,
    dangerDetection: config.dangerDetection,
    sandbox: config.sandbox,
    redactSecrets: config.redactSecrets,
    allowedCommands: config.allowedCommands,
    blockedCommands: config.blockedCommands,
    allowedPaths: config.allowedPaths,
  });

  await server.connect(transport);
}

main().catch((err) => {
  console.error("[mcp-terminal] Fatal error:", err);
  sessionManager.closeAll();
  process.exit(1);
});
