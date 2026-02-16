import type { ChildProcess } from "node:child_process";

// --- Configuration ---

export interface ServerConfig {
  maxSessions: number;
  maxOutput: number;
  defaultTimeout: number;
  blockedCommands: string[];
  allowedCommands: string[];
  allowedPaths: string[];
  redactSecrets: boolean;
  logInputs: boolean;
  idleTimeout: number;
  dangerDetection: boolean;
  auditLog: string;
  sandbox: boolean;
  sandboxAllowWrite: string[];
  sandboxAllowNetwork: string[];
}

export function loadConfig(): ServerConfig {
  const envList = (key: string, fallback: string[] = []): string[] => {
    const val = process.env[key];
    if (!val) return fallback;
    return val.split(",").map((s) => s.trim()).filter(Boolean);
  };

  return {
    maxSessions: parseInt(process.env.MCP_TERMINAL_MAX_SESSIONS || "10", 10),
    maxOutput: parseInt(process.env.MCP_TERMINAL_MAX_OUTPUT || "20000", 10),
    defaultTimeout: parseInt(process.env.MCP_TERMINAL_DEFAULT_TIMEOUT || "5000", 10),
    blockedCommands: envList("MCP_TERMINAL_BLOCKED_COMMANDS"),
    allowedCommands: envList("MCP_TERMINAL_ALLOWED_COMMANDS"),
    allowedPaths: envList("MCP_TERMINAL_ALLOWED_PATHS"),
    redactSecrets: process.env.MCP_TERMINAL_REDACT_SECRETS === "true",
    logInputs: process.env.MCP_TERMINAL_LOG_INPUTS === "true",
    idleTimeout: parseInt(process.env.MCP_TERMINAL_IDLE_TIMEOUT || "1800000", 10),
    dangerDetection: process.env.MCP_TERMINAL_DANGER_DETECTION !== "false",
    auditLog: process.env.MCP_TERMINAL_AUDIT_LOG || "",
    sandbox: process.env.MCP_TERMINAL_SANDBOX === "true",
    sandboxAllowWrite: envList("MCP_TERMINAL_SANDBOX_ALLOW_WRITE", ["/tmp"]),
    sandboxAllowNetwork: envList("MCP_TERMINAL_SANDBOX_ALLOW_NETWORK", ["*"]),
  };
}

// --- Session ---

export interface Session {
  id: string;
  name: string;
  command: string;
  args: string[];
  pid: number;
  createdAt: Date;
  lastActivity: Date;
  isAlive: boolean;
  terminal: TerminalWrapper;
  pendingDangerousCommands: Set<string>;
}

export interface SessionInfo {
  session_id: string;
  name: string;
  command: string;
  pid: number;
  is_alive: boolean;
  created_at: string;
}

// --- Terminal Wrapper ---

export interface TerminalWrapper {
  process: ChildProcess | { pid: number; kill(signal?: string): void };
  pid: number;
  isAlive: boolean;
  promptPattern: RegExp | null;
  mode: "pty" | "pipe";
  write(data: string): void;
  readScreen(fullScreen?: boolean): string;
  waitForOutput(timeoutMs: number): Promise<{ output: string; isComplete: boolean }>;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  dispose(): void;
}

// --- Tool I/O types ---

export interface CreateSessionInput {
  command: string;
  args?: string[];
  name?: string;
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export interface CreateSessionOutput {
  session_id: string;
  name: string;
  pid: number;
}

export interface SendCommandInput {
  session_id: string;
  input: string;
  timeout_ms?: number;
  max_output_chars?: number;
}

export interface SendCommandOutput {
  output: string;
  is_complete: boolean;
  is_alive: boolean;
  warning?: string;
}

export interface ReadOutputInput {
  session_id: string;
  full_screen?: boolean;
}

export interface ReadOutputOutput {
  output: string;
  is_alive: boolean;
}

export interface CloseSessionInput {
  session_id: string;
  signal?: string;
}

export interface CloseSessionOutput {
  success: boolean;
}

export interface SendControlInput {
  session_id: string;
  control: string;
}

export interface SendControlOutput {
  output: string;
}

export interface ConfirmDangerousCommandInput {
  session_id: string;
  input: string;
  justification: string;
}

export interface ConfirmDangerousCommandOutput {
  output: string;
  is_complete: boolean;
  is_alive: boolean;
}

// --- Control key mapping ---

export const CONTROL_KEYS: Record<string, string> = {
  "ctrl+a": "\x01",
  "ctrl+b": "\x02",
  "ctrl+c": "\x03",
  "ctrl+d": "\x04",
  "ctrl+e": "\x05",
  "ctrl+f": "\x06",
  "ctrl+k": "\x0b",
  "ctrl+l": "\x0c",
  "ctrl+n": "\x0e",
  "ctrl+p": "\x10",
  "ctrl+r": "\x12",
  "ctrl+u": "\x15",
  "ctrl+w": "\x17",
  "ctrl+z": "\x1a",
  "ctrl+\\": "\x1c",
  "ctrl+]": "\x1d",
  "enter": "\r",
  "tab": "\t",
  "escape": "\x1b",
  "up": "\x1b[A",
  "down": "\x1b[B",
  "right": "\x1b[C",
  "left": "\x1b[D",
  "home": "\x1b[H",
  "end": "\x1b[F",
  "backspace": "\x7f",
  "delete": "\x1b[3~",
};
