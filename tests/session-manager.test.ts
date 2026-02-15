import { describe, it, expect, afterEach } from "vitest";
import { SessionManager } from "../src/session-manager.js";
import type { ServerConfig } from "../src/types.js";
import { canSpawnPty } from "./can-spawn-pty.js";

const BASH = "/bin/bash";
const ptyAvailable = canSpawnPty(BASH);
const itPty = ptyAvailable ? it : it.skip;

const defaultConfig: ServerConfig = {
  maxSessions: 10,
  maxOutput: 20000,
  defaultTimeout: 5000,
  blockedCommands: [],
  allowedCommands: [],
  allowedPaths: [],
  redactSecrets: false,
  logInputs: false,
  idleTimeout: 0,
  dangerDetection: true,
  sandbox: false,
  sandboxAllowWrite: ["/tmp"],
  sandboxAllowNetwork: ["*"],
  auditLog: "",
};

describe("SessionManager", () => {
  let manager: SessionManager;

  afterEach(() => {
    if (manager) {
      manager.closeAll();
    }
  });

  itPty("creates a session and returns session info", async () => {
    manager = new SessionManager(defaultConfig);
    const session = await manager.createSession({ command: BASH });

    expect(session.id).toBeTruthy();
    expect(session.command).toBe(BASH);
    expect(session.pid).toBeGreaterThan(0);
    expect(session.isAlive).toBe(true);
  }, 10000);

  itPty("lists sessions", async () => {
    manager = new SessionManager(defaultConfig);
    await manager.createSession({ command: BASH, name: "test-bash" });

    const list = manager.listSessions();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe("test-bash");
    expect(list[0].command).toBe(BASH);
  }, 10000);

  itPty("closes a session", async () => {
    manager = new SessionManager(defaultConfig);
    const session = await manager.createSession({ command: BASH });

    manager.closeSession(session.id);
    expect(manager.listSessions().length).toBe(0);
  }, 10000);

  itPty("enforces max sessions", async () => {
    manager = new SessionManager({ ...defaultConfig, maxSessions: 1 });
    await manager.createSession({ command: BASH });

    await expect(manager.createSession({ command: BASH })).rejects.toThrow(
      /Maximum sessions/
    );
  }, 10000);

  it("enforces command blocklist", async () => {
    manager = new SessionManager({ ...defaultConfig, blockedCommands: ["dangerous-cmd"] });

    await expect(manager.createSession({ command: "dangerous-cmd" })).rejects.toThrow(
      /blocked/
    );
  }, 10000);

  it("enforces command allowlist", async () => {
    manager = new SessionManager({ ...defaultConfig, allowedCommands: [BASH] });

    await expect(manager.createSession({ command: "python3" })).rejects.toThrow(
      /not in the allowed list/
    );
  }, 10000);

  it("throws on unknown session id", () => {
    manager = new SessionManager(defaultConfig);
    expect(() => manager.getSession("nonexistent")).toThrow(/not found/);
  });

  it("enforces allowed paths on session creation", async () => {
    manager = new SessionManager({ ...defaultConfig, allowedPaths: ["/tmp"] });

    await expect(
      manager.createSession({ command: BASH, cwd: "/usr/local" })
    ).rejects.toThrow(/not in the allowed paths/);
  }, 10000);

  itPty("allows sessions within allowed paths", async () => {
    manager = new SessionManager({ ...defaultConfig, allowedPaths: ["/tmp"] });

    const session = await manager.createSession({ command: BASH, cwd: "/tmp" });
    expect(session.isAlive).toBe(true);
  }, 10000);

  it("isPathAllowed checks subdirectories", () => {
    manager = new SessionManager({ ...defaultConfig, allowedPaths: ["/home/user/projects"] });

    expect(manager.isPathAllowed("/home/user/projects")).toBe(true);
    expect(manager.isPathAllowed("/home/user/projects/app")).toBe(true);
    expect(manager.isPathAllowed("/home/user")).toBe(false);
    expect(manager.isPathAllowed("/etc")).toBe(false);
  });

  it("allows all paths when allowedPaths is empty", () => {
    manager = new SessionManager(defaultConfig);

    expect(manager.isPathAllowed("/anywhere")).toBe(true);
    expect(manager.isPathAllowed("/etc/passwd")).toBe(true);
  });
});
