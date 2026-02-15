/**
 * Helper to check if the full PTY pipeline (node-pty + xterm-headless) works.
 * In sandboxed environments, posix_spawnp may be blocked or xterm may fail.
 */
import * as pty from "node-pty";
import { Terminal } from "@xterm/headless";

export function canSpawnPty(command: string): boolean {
  try {
    // Test xterm-headless
    const xterm = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
    xterm.buffer.active.getLine(0); // This throws without allowProposedApi
    xterm.dispose();

    // Test node-pty spawn
    const proc = pty.spawn(command, [], {
      name: "xterm",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
    proc.kill();
    return true;
  } catch {
    return false;
  }
}
