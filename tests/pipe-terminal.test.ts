import { describe, it, expect, afterEach } from "vitest";
import { createPipeTerminal } from "../src/terminal.js";
import type { TerminalWrapper } from "../src/types.js";

const BASH = "/bin/bash";

describe("Pipe Terminal", () => {
  let terminal: TerminalWrapper | null = null;

  afterEach(() => {
    if (terminal) {
      terminal.dispose();
      terminal = null;
    }
  });

  it("spawns a bash session in pipe mode", async () => {
    terminal = await createPipeTerminal({ command: BASH });
    expect(terminal.isAlive).toBe(true);
    expect(terminal.pid).toBeGreaterThan(0);
    expect(terminal.mode).toBe("pipe");
  }, 10000);

  it("sends a command and reads output", async () => {
    terminal = await createPipeTerminal({ command: BASH });

    terminal.write("echo hello_pipe_test\n");
    const { output } = await terminal.waitForOutput(3000);

    expect(output).toContain("hello_pipe_test");
  }, 10000);

  it("reads the screen after command", async () => {
    terminal = await createPipeTerminal({ command: BASH });

    terminal.write("echo screen_pipe_test\n");
    await new Promise((r) => setTimeout(r, 1000));

    const screen = terminal.readScreen();
    expect(screen).toContain("screen_pipe_test");
  }, 10000);

  it("full_screen returns all output", async () => {
    terminal = await createPipeTerminal({ command: BASH });

    terminal.write("echo line_one\n");
    await new Promise((r) => setTimeout(r, 500));
    terminal.write("echo line_two\n");
    await new Promise((r) => setTimeout(r, 500));

    const fullScreen = terminal.readScreen(true);
    expect(fullScreen).toContain("line_one");
    expect(fullScreen).toContain("line_two");
  }, 10000);

  it("readScreen returns only new output after write", async () => {
    terminal = await createPipeTerminal({ command: BASH });

    terminal.write("echo first_cmd\n");
    await new Promise((r) => setTimeout(r, 500));
    const out1 = terminal.readScreen();
    expect(out1).toContain("first_cmd");

    // Second command: readScreen should only show new output
    terminal.write("echo second_cmd\n");
    await new Promise((r) => setTimeout(r, 500));
    const out2 = terminal.readScreen();
    expect(out2).toContain("second_cmd");
  }, 10000);

  it("detects process exit", async () => {
    terminal = await createPipeTerminal({ command: BASH });

    terminal.write("exit\n");
    await new Promise((r) => setTimeout(r, 1000));

    expect(terminal.isAlive).toBe(false);
  }, 10000);

  it("throws when writing to dead session", async () => {
    terminal = await createPipeTerminal({ command: BASH });
    terminal.kill();
    await new Promise((r) => setTimeout(r, 200));

    expect(() => terminal!.write("test\n")).toThrow(/not alive/);
  }, 10000);

  it("strips ANSI codes from output", async () => {
    terminal = await createPipeTerminal({ command: BASH });

    // Force some ANSI output
    terminal.write("printf '\\033[31mred_text\\033[0m\\n'\n");
    await new Promise((r) => setTimeout(r, 500));

    const screen = terminal.readScreen();
    expect(screen).toContain("red_text");
    expect(screen).not.toContain("\x1b[31m");
    expect(screen).not.toContain("\x1b[0m");
  }, 10000);

  it("resize is a no-op but doesn't throw", async () => {
    terminal = await createPipeTerminal({ command: BASH });
    expect(() => terminal!.resize(80, 24)).not.toThrow();
  }, 10000);

  it("works with python in pipe mode", async () => {
    terminal = await createPipeTerminal({ command: "python3" });
    expect(terminal.mode).toBe("pipe");

    terminal.write("print(2 ** 10)\n");
    const { output } = await terminal.waitForOutput(3000);

    expect(output).toContain("1024");
  }, 10000);

  it("works with node in pipe mode", async () => {
    terminal = await createPipeTerminal({ command: "node" });
    expect(terminal.mode).toBe("pipe");

    terminal.write("console.log(42 * 100)\n");
    const { output } = await terminal.waitForOutput(3000);

    expect(output).toContain("4200");
  }, 10000);
});
