/**
 * Core terminal wrapper: PTY + xterm-headless.
 *
 * Spawns an interactive process via node-pty, feeds output into
 * xterm-headless for clean rendering, and provides methods to
 * read the screen as plain text.
 */

import pty from "node-pty";
import xterm from "@xterm/headless";
const { Terminal } = xterm;
import type { TerminalWrapper } from "./types.js";
import { detectPromptPattern, endsWithPrompt } from "./utils/output-detector.js";

const OUTPUT_SETTLE_MS = 300;

export interface TerminalOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export function createTerminal(options: TerminalOptions): Promise<TerminalWrapper> {
  return new Promise((resolve, reject) => {
    const cols = options.cols ?? 120;
    const rows = options.rows ?? 40;

    const xterm = new Terminal({ cols, rows, scrollback: 1000 });

    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(options.command, options.args ?? [], {
        name: "xterm-256color",
        cols,
        rows,
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env } as Record<string, string>,
      });
    } catch (err) {
      xterm.dispose();
      reject(new Error(`Failed to spawn "${options.command}": ${err}`));
      return;
    }

    let isAlive = true;
    let promptPattern: RegExp | null = null;
    // Buffer to accumulate new output since last read
    let outputBuffer = "";
    let lastOutputTime = Date.now();

    // Feed PTY output into xterm
    ptyProcess.onData((data: string) => {
      xterm.write(data);
      outputBuffer += data;
      lastOutputTime = Date.now();
    });

    ptyProcess.onExit(() => {
      isAlive = false;
    });

    const wrapper: TerminalWrapper = {
      pty: ptyProcess,
      xterm,
      get isAlive() {
        return isAlive;
      },
      promptPattern,

      write(data: string) {
        if (!isAlive) throw new Error("Session is not alive");
        // Clear the output buffer before writing so we only capture new output
        outputBuffer = "";
        ptyProcess.write(data);
      },

      readScreen(fullScreen = false): string {
        const buffer = xterm.buffer.active;
        const lines: string[] = [];

        if (fullScreen) {
          // Read entire scrollback + visible area
          const start = -buffer.viewportY;
          for (let i = start; i < buffer.length; i++) {
            const line = buffer.getLine(i);
            if (line) {
              lines.push(line.translateToString(true));
            }
          }
        } else {
          // Read only the visible viewport area
          for (let i = 0; i < rows; i++) {
            const line = buffer.getLine(buffer.baseY + i);
            if (line) {
              lines.push(line.translateToString(true));
            }
          }
        }

        // Trim trailing empty lines
        while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
          lines.pop();
        }

        return lines.join("\n");
      },

      async waitForOutput(timeoutMs: number): Promise<{ output: string; isComplete: boolean }> {
        const startOutput = outputBuffer;
        const startTime = Date.now();

        return new Promise((res) => {
          let settled = false;

          const check = () => {
            const elapsed = Date.now() - startTime;

            // Layer 1: Process exit
            if (!isAlive) {
              res({ output: wrapper.readScreen(), isComplete: true });
              return;
            }

            // Layer 4: Timeout
            if (elapsed >= timeoutMs) {
              res({ output: wrapper.readScreen(), isComplete: false });
              return;
            }

            const timeSinceOutput = Date.now() - lastOutputTime;

            // Layer 3: Output settling
            if (timeSinceOutput >= OUTPUT_SETTLE_MS && outputBuffer !== startOutput) {
              const screen = wrapper.readScreen();
              // Layer 2: Prompt detection
              if (wrapper.promptPattern && endsWithPrompt(screen, wrapper.promptPattern)) {
                res({ output: screen, isComplete: true });
                return;
              }
              // Output settled but no prompt — might still be running
              // Give a bit more time unless we're close to timeout
              if (!settled) {
                settled = true;
                // Wait one more settle period
                setTimeout(check, OUTPUT_SETTLE_MS);
                return;
              }
              // Second settle — consider it done
              res({ output: screen, isComplete: true });
              return;
            }

            // Keep checking
            setTimeout(check, 50);
          };

          // Start checking after a brief initial delay
          setTimeout(check, 50);
        });
      },

      resize(newCols: number, newRows: number) {
        ptyProcess.resize(newCols, newRows);
        xterm.resize(newCols, newRows);
      },

      kill(signal?: string) {
        if (isAlive) {
          ptyProcess.kill(signal);
          isAlive = false;
        }
      },

      dispose() {
        if (isAlive) {
          ptyProcess.kill();
          isAlive = false;
        }
        xterm.dispose();
      },
    };

    // Wait for initial startup output to detect prompt
    setTimeout(() => {
      const startupScreen = wrapper.readScreen();
      promptPattern = detectPromptPattern(startupScreen);
      wrapper.promptPattern = promptPattern;
      resolve(wrapper);
    }, 1000);
  });
}
