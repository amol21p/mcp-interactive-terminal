/**
 * Core terminal wrapper.
 *
 * Strategy:
 *   1. Try node-pty + xterm-headless (best: true PTY, clean rendered output)
 *   2. Fallback to child_process.spawn with pipes (works in sandboxed environments)
 *
 * The fallback loses PTY features (no terminal emulation, no resize) but
 * provides working interactive sessions in Claude Code's sandbox.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { TerminalWrapper } from "./types.js";
import { detectPromptPattern, endsWithPrompt } from "./utils/output-detector.js";
import { stripAnsi } from "./utils/sanitizer.js";
import { wrapCommand, isSandboxActive } from "./sandbox.js";

const OUTPUT_SETTLE_MS = 300;

export interface TerminalOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

/**
 * Create a terminal wrapper. Tries node-pty first, falls back to child_process.
 */
export async function createTerminal(options: TerminalOptions): Promise<TerminalWrapper> {
  try {
    return await createPtyTerminal(options);
  } catch (ptyErr) {
    console.error(`[mcp-terminal] node-pty failed (${ptyErr}), falling back to pipe mode`);
    return createPipeTerminal(options);
  }
}

// ─── PTY mode (node-pty + xterm-headless) ───────────────────────────

async function createPtyTerminal(options: TerminalOptions): Promise<TerminalWrapper> {
  // Dynamic imports — these are optional deps in pipe-fallback mode
  const pty = await import("node-pty");
  const xtermMod = await import("@xterm/headless");
  const Terminal = xtermMod.Terminal ?? (xtermMod as any).default?.Terminal;

  const cols = options.cols ?? 120;
  const rows = options.rows ?? 40;
  const xterm = new Terminal({ cols, rows, scrollback: 1000, allowProposedApi: true });

  const ptyProcess = pty.spawn(options.command, options.args ?? [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...options.env } as Record<string, string>,
  });

  let isAlive = true;
  let promptPattern: RegExp | null = null;
  let outputBuffer = "";
  let lastOutputTime = Date.now();

  ptyProcess.onData((data: string) => {
    xterm.write(data);
    outputBuffer += data;
    lastOutputTime = Date.now();
  });

  ptyProcess.onExit(() => {
    isAlive = false;
  });

  const wrapper: TerminalWrapper = {
    process: ptyProcess as any,
    pid: ptyProcess.pid,
    get isAlive() { return isAlive; },
    promptPattern,
    mode: "pty",

    write(data: string) {
      if (!isAlive) throw new Error("Session is not alive");
      outputBuffer = "";
      ptyProcess.write(data);
    },

    readScreen(fullScreen = false): string {
      const buffer = xterm.buffer.active;
      const lines: string[] = [];
      if (fullScreen) {
        const start = -buffer.viewportY;
        for (let i = start; i < buffer.length; i++) {
          const line = buffer.getLine(i);
          if (line) lines.push(line.translateToString(true));
        }
      } else {
        for (let i = 0; i < rows; i++) {
          const line = buffer.getLine(buffer.baseY + i);
          if (line) lines.push(line.translateToString(true));
        }
      }
      while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
      return lines.join("\n");
    },

    async waitForOutput(timeoutMs: number) {
      return waitForSettled(() => isAlive, () => outputBuffer, () => lastOutputTime, () => wrapper.readScreen(), timeoutMs, wrapper);
    },

    resize(newCols: number, newRows: number) {
      ptyProcess.resize(newCols, newRows);
      xterm.resize(newCols, newRows);
    },

    kill(signal?: string) {
      if (isAlive) { ptyProcess.kill(signal); isAlive = false; }
    },

    dispose() {
      if (isAlive) { ptyProcess.kill(); isAlive = false; }
      xterm.dispose();
    },
  };

  // Wait for startup output to detect prompt
  await new Promise((r) => setTimeout(r, 1000));
  const startupScreen = wrapper.readScreen();
  promptPattern = detectPromptPattern(startupScreen);
  wrapper.promptPattern = promptPattern;
  return wrapper;
}

// ─── Pipe mode (child_process fallback) ─────────────────────────────

/**
 * In pipe mode, some programs need extra flags to behave interactively.
 * Returns modified args array with interactive flags prepended if needed.
 */
function pipeInteractiveArgs(command: string, args: string[]): string[] {
  const base = command.split("/").pop() ?? command;

  // Python: needs -i for interactive mode, -u for unbuffered
  if (/^python[23]?$/.test(base)) {
    const hasI = args.includes("-i") || args.includes("-u");
    if (!hasI) return ["-u", "-i", ...args];
    if (!args.includes("-u")) return ["-u", ...args];
    return args;
  }

  // Node: needs --interactive (or -i) for REPL when stdin is piped
  if (base === "node" || base === "nodejs") {
    const hasI = args.includes("-i") || args.includes("--interactive");
    if (!hasI) return ["--interactive", ...args];
    return args;
  }

  // Bash/zsh/sh: add -i for interactive mode, but NOT when using -c (command string)
  if (/^(ba)?sh$|^zsh$/.test(base)) {
    if (args.includes("-c")) return args; // -c means non-interactive command wrapper
    const hasI = args.includes("-i");
    if (!hasI) return ["-i", ...args];
    return args;
  }

  return args;
}

/**
 * Create a pipe-mode terminal directly (exported for testing).
 */
export async function createPipeTerminal(options: TerminalOptions): Promise<TerminalWrapper> {
  const args = pipeInteractiveArgs(options.command, options.args ?? []);
  const envVars = {
    ...process.env,
    TERM: "dumb",
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    NODE_NO_READLINE: "1",
    ...options.env,
  };

  // If sandbox is active, wrap the command
  let proc: ChildProcess;
  if (isSandboxActive()) {
    const fullCmd = [options.command, ...args].map((a) => a.includes(" ") ? `"${a}"` : a).join(" ");
    const { command: wrappedCmd } = await wrapCommand(fullCmd);
    try {
      proc = spawn(wrappedCmd, {
        cwd: options.cwd ?? process.cwd(),
        env: envVars,
        stdio: ["pipe", "pipe", "pipe"],
        shell: true,
        detached: true,
      });
    } catch (err) {
      throw new Error(`Failed to spawn sandboxed "${options.command}": ${err}`);
    }
  } else {
    try {
      proc = spawn(options.command, args, {
        cwd: options.cwd ?? process.cwd(),
        env: envVars,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
    } catch (err) {
      throw new Error(`Failed to spawn "${options.command}": ${err}`);
    }
  }

  return new Promise((resolve, reject) => {

    if (!proc.pid) {
      // Handle spawn errors that come async
      proc.once("error", (err) => {
        reject(new Error(`Failed to spawn "${options.command}": ${err.message}`));
      });
      // Give it a moment to either get a pid or error
      setTimeout(() => {
        if (!proc.pid) {
          reject(new Error(`Failed to spawn "${options.command}": no pid assigned`));
        }
      }, 500);
      return;
    }

    let isAlive = true;
    let promptPattern: RegExp | null = null;
    let outputLines: string[] = [];
    let lastOutputTime = Date.now();
    let outputGeneration = 0;
    // Separate buffer for output since last write()
    let newOutputBuffer = "";

    const appendOutput = (data: Buffer) => {
      const text = data.toString();
      newOutputBuffer += text;

      // Also maintain full output lines for full_screen reads
      const parts = text.split("\n");
      if (parts.length === 1) {
        if (outputLines.length === 0) outputLines.push("");
        outputLines[outputLines.length - 1] += parts[0];
      } else {
        if (outputLines.length > 0) {
          outputLines[outputLines.length - 1] += parts[0];
        } else {
          outputLines.push(parts[0]);
        }
        for (let i = 1; i < parts.length; i++) {
          outputLines.push(parts[i]);
        }
      }
      lastOutputTime = Date.now();
      outputGeneration++;

      // Cap scrollback at 2000 lines
      if (outputLines.length > 2000) {
        outputLines = outputLines.slice(-1000);
      }
    };

    proc.stdout!.on("data", appendOutput);
    proc.stderr!.on("data", appendOutput);

    proc.on("exit", () => { isAlive = false; });
    proc.on("error", () => { isAlive = false; });

    const wrapper: TerminalWrapper = {
      process: proc,
      pid: proc.pid!,
      get isAlive() { return isAlive; },
      promptPattern,
      mode: "pipe",

      write(data: string) {
        if (!isAlive) throw new Error("Session is not alive");
        // Clear new output buffer so readScreen returns only new output
        newOutputBuffer = "";
        proc.stdin!.write(data);
      },

      readScreen(fullScreen = false): string {
        if (fullScreen) {
          return stripAnsi(outputLines.join("\n"));
        }
        // Return only output received since the last write()
        return stripAnsi(newOutputBuffer);
      },

      async waitForOutput(timeoutMs: number) {
        const startGen = outputGeneration;
        return waitForSettled(
          () => isAlive,
          () => String(outputGeneration),
          () => lastOutputTime,
          () => wrapper.readScreen(),
          timeoutMs,
          wrapper,
        );
      },

      resize(_cols: number, _rows: number) {
        // No-op in pipe mode — no PTY to resize
      },

      kill(signal?: string) {
        if (isAlive) {
          const sig = (signal as NodeJS.Signals) ?? "SIGTERM";
          try { process.kill(-proc.pid!, sig); } catch { proc.kill(sig); }
          isAlive = false;
        }
      },

      dispose() {
        if (isAlive) {
          try { process.kill(-proc.pid!, "SIGTERM"); } catch { proc.kill("SIGTERM"); }
          isAlive = false;
        }
      },
    };

    // Wait for startup output to detect prompt
    setTimeout(() => {
      const startupScreen = wrapper.readScreen();
      promptPattern = detectPromptPattern(startupScreen);
      wrapper.promptPattern = promptPattern;
      resolve(wrapper);
    }, 1000);
  });
}

// ─── Shared wait logic ──────────────────────────────────────────────

function waitForSettled(
  getAlive: () => boolean,
  getOutputMarker: () => string,
  getLastOutputTime: () => number,
  getScreen: () => string,
  timeoutMs: number,
  wrapper: TerminalWrapper,
): Promise<{ output: string; isComplete: boolean }> {
  const startMarker = getOutputMarker();
  const startTime = Date.now();

  return new Promise((res) => {
    let settled = false;

    const check = () => {
      const elapsed = Date.now() - startTime;

      if (!getAlive()) {
        res({ output: getScreen(), isComplete: true });
        return;
      }

      if (elapsed >= timeoutMs) {
        res({ output: getScreen(), isComplete: false });
        return;
      }

      const timeSinceOutput = Date.now() - getLastOutputTime();

      if (timeSinceOutput >= OUTPUT_SETTLE_MS && getOutputMarker() !== startMarker) {
        const screen = getScreen();
        if (wrapper.promptPattern && endsWithPrompt(screen, wrapper.promptPattern)) {
          res({ output: screen, isComplete: true });
          return;
        }
        if (!settled) {
          settled = true;
          setTimeout(check, OUTPUT_SETTLE_MS);
          return;
        }
        res({ output: screen, isComplete: true });
        return;
      }

      setTimeout(check, 50);
    };

    setTimeout(check, 50);
  });
}
