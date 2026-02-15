import { describe, it, expect, afterEach } from "vitest";
import { createTerminal } from "../src/terminal.js";
import type { TerminalWrapper } from "../src/types.js";
import { canSpawnPty } from "./can-spawn-pty.js";

const BASH = "/bin/bash";
const ptyAvailable = canSpawnPty(BASH);
const itPty = ptyAvailable ? it : it.skip;

describe("Terminal", () => {
  let terminal: TerminalWrapper | null = null;

  afterEach(() => {
    if (terminal) {
      terminal.dispose();
      terminal = null;
    }
  });

  itPty("spawns a bash session", async () => {
    terminal = await createTerminal({ command: BASH });
    expect(terminal.isAlive).toBe(true);
    expect(terminal.pid).toBeGreaterThan(0);
  }, 10000);

  itPty("sends a command and reads output", async () => {
    terminal = await createTerminal({ command: BASH });

    terminal.write("echo hello_test_123\n");
    const { output } = await terminal.waitForOutput(3000);

    expect(output).toContain("hello_test_123");
  }, 10000);

  itPty("reads the screen", async () => {
    terminal = await createTerminal({ command: BASH });

    terminal.write("echo screen_test\n");
    await new Promise((r) => setTimeout(r, 1000));

    const screen = terminal.readScreen();
    expect(screen).toContain("screen_test");
  }, 10000);

  itPty("detects process exit", async () => {
    terminal = await createTerminal({ command: BASH });

    terminal.write("exit\n");
    await new Promise((r) => setTimeout(r, 1000));

    expect(terminal.isAlive).toBe(false);
  }, 10000);

  itPty("handles resize", async () => {
    terminal = await createTerminal({ command: BASH, cols: 80, rows: 24 });
    terminal.resize(120, 40);
    expect(terminal.isAlive).toBe(true);
  }, 10000);

  itPty("throws when writing to dead session", async () => {
    terminal = await createTerminal({ command: BASH });
    terminal.kill();
    await new Promise((r) => setTimeout(r, 200));

    expect(() => terminal!.write("test\n")).toThrow(/not alive/);
  }, 10000);
});
