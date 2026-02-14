/**
 * Helper to check if node-pty can actually spawn processes.
 * In sandboxed environments, posix_spawnp may be blocked.
 */
import * as pty from "node-pty";

export function canSpawnPty(command: string): boolean {
  try {
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
