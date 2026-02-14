/**
 * Session lifecycle management.
 * Handles creation, lookup, idle cleanup, and resource limits.
 */

import { randomUUID } from "node:crypto";
import { createTerminal, type TerminalOptions } from "./terminal.js";
import type { Session, SessionInfo, ServerConfig } from "./types.js";

export class SessionManager {
  private sessions = new Map<string, Session>();
  private idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private config: ServerConfig) {}

  get sessionCount(): number {
    return this.sessions.size;
  }

  async createSession(options: TerminalOptions & { name?: string }): Promise<Session> {
    // Check limits
    if (this.sessions.size >= this.config.maxSessions) {
      throw new Error(
        `Maximum sessions (${this.config.maxSessions}) reached. Close an existing session first.`
      );
    }

    // Validate command against allowlist/blocklist
    this.validateCommand(options.command);

    const terminal = await createTerminal(options);
    const id = randomUUID().slice(0, 8);
    const session: Session = {
      id,
      name: options.name ?? `${options.command}-${id}`,
      command: options.command,
      args: options.args ?? [],
      pid: terminal.pty.pid,
      createdAt: new Date(),
      lastActivity: new Date(),
      isAlive: true,
      terminal,
      pendingDangerousCommands: new Set(),
    };

    this.sessions.set(id, session);

    // Set up idle timeout if configured
    if (this.config.idleTimeout > 0) {
      this.resetIdleTimer(id);
    }

    // Update isAlive on process exit
    const checkAlive = setInterval(() => {
      if (!terminal.isAlive) {
        session.isAlive = false;
        clearInterval(checkAlive);
      }
    }, 1000);

    return session;
  }

  getSession(id: string): Session {
    const session = this.sessions.get(id);
    if (!session) {
      throw new Error(`Session "${id}" not found`);
    }
    // Sync alive status
    session.isAlive = session.terminal.isAlive;
    return session;
  }

  listSessions(): SessionInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({
      session_id: s.id,
      name: s.name,
      command: s.command,
      pid: s.pid,
      is_alive: s.terminal.isAlive,
      created_at: s.createdAt.toISOString(),
    }));
  }

  closeSession(id: string, signal?: string): void {
    const session = this.getSession(id);
    session.terminal.kill(signal);
    session.terminal.dispose();
    session.isAlive = false;
    this.sessions.delete(id);
    this.clearIdleTimer(id);
  }

  closeAll(): void {
    for (const [id] of this.sessions) {
      try {
        this.closeSession(id);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }

  touchSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastActivity = new Date();
      if (this.config.idleTimeout > 0) {
        this.resetIdleTimer(id);
      }
    }
  }

  private validateCommand(command: string): void {
    const base = command.split("/").pop() ?? command;

    if (this.config.allowedCommands.length > 0) {
      if (!this.config.allowedCommands.includes(base)) {
        throw new Error(
          `Command "${base}" is not in the allowed list: ${this.config.allowedCommands.join(", ")}`
        );
      }
    }

    if (this.config.blockedCommands.includes(base)) {
      throw new Error(`Command "${base}" is blocked by configuration`);
    }
  }

  private resetIdleTimer(id: string): void {
    this.clearIdleTimer(id);
    const timer = setTimeout(() => {
      const session = this.sessions.get(id);
      if (session) {
        console.error(`[mcp-terminal] Session "${id}" (${session.name}) closed due to idle timeout`);
        try {
          this.closeSession(id);
        } catch {
          // Ignore
        }
      }
    }, this.config.idleTimeout);
    this.idleTimers.set(id, timer);
  }

  private clearIdleTimer(id: string): void {
    const timer = this.idleTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(id);
    }
  }
}
