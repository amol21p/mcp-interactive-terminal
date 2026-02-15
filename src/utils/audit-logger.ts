/**
 * Structured audit logger for security-relevant events.
 *
 * All entries are JSON lines written to stderr (and optionally to a file).
 * Format:
 *   {"ts":"2026-02-15T...","event":"command","session":"abc123","detail":{...}}
 */

import { appendFileSync } from "node:fs";

export type AuditEvent =
  | "server_start"
  | "server_stop"
  | "session_create"
  | "session_close"
  | "session_idle_timeout"
  | "command"
  | "command_blocked_danger"
  | "command_confirmed_danger"
  | "command_blocked_path"
  | "control"
  | "read_output"
  | "list_sessions"
  | "sandbox_init"
  | "sandbox_fail";

export interface AuditEntry {
  ts: string;
  event: AuditEvent;
  session?: string;
  detail?: Record<string, unknown>;
}

let auditFilePath: string | null = null;

/**
 * Configure the audit logger. Call once at startup.
 */
export function configureAudit(filePath?: string): void {
  auditFilePath = filePath ?? null;
}

/**
 * Write a structured audit log entry.
 */
export function audit(event: AuditEvent, session?: string, detail?: Record<string, unknown>): void {
  const entry: AuditEntry = {
    ts: new Date().toISOString(),
    event,
    ...(session ? { session } : {}),
    ...(detail && Object.keys(detail).length > 0 ? { detail } : {}),
  };

  const line = JSON.stringify(entry);
  console.error(`[audit] ${line}`);

  if (auditFilePath) {
    try {
      appendFileSync(auditFilePath, line + "\n");
    } catch {
      // Don't crash on log write failure
    }
  }
}
