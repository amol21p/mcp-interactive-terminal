import { describe, it, expect } from "vitest";
import {
  stripAnsi,
  cleanWhitespace,
  stripCommandEcho,
  truncateOutput,
  sanitize,
} from "../src/utils/sanitizer.js";

describe("stripAnsi", () => {
  it("removes SGR color codes", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });

  it("removes cursor movement codes", () => {
    expect(stripAnsi("\x1b[2Ahello\x1b[3B")).toBe("hello");
  });

  it("removes OSC sequences", () => {
    expect(stripAnsi("\x1b]0;title\x07content")).toBe("content");
  });

  it("leaves clean text unchanged", () => {
    expect(stripAnsi("just plain text")).toBe("just plain text");
  });
});

describe("cleanWhitespace", () => {
  it("trims trailing whitespace from lines", () => {
    expect(cleanWhitespace("hello   \nworld  ")).toBe("hello\nworld");
  });

  it("collapses excessive blank lines", () => {
    const input = "a\n\n\n\n\nb";
    expect(cleanWhitespace(input)).toBe("a\n\nb");
  });

  it("preserves up to 2 consecutive blank lines", () => {
    const input = "a\n\n\nb";
    expect(cleanWhitespace(input)).toBe("a\n\nb");
  });
});

describe("stripCommandEcho", () => {
  it("strips echoed command from first line", () => {
    expect(stripCommandEcho("ls -la\nfile1\nfile2", "ls -la")).toBe("file1\nfile2");
  });

  it("strips prompt-prefixed echo", () => {
    expect(stripCommandEcho(">>> print('hi')\nhi", "print('hi')")).toBe("hi");
  });

  it("leaves output alone if no echo detected", () => {
    expect(stripCommandEcho("output only", "other-command")).toBe("output only");
  });
});

describe("truncateOutput", () => {
  it("returns short output unchanged", () => {
    expect(truncateOutput("short", 1000)).toBe("short");
  });

  it("truncates long output with notice", () => {
    const long = "a".repeat(100);
    const result = truncateOutput(long, 50);
    expect(result.length).toBeLessThan(100);
    expect(result).toContain("[output truncated");
  });

  it("prefers to break at newline", () => {
    const lines = Array(20).fill("line of text").join("\n");
    const result = truncateOutput(lines, 100);
    expect(result).toContain("[output truncated");
  });
});

describe("sanitize", () => {
  it("applies full pipeline", () => {
    const input = "\x1b[32mecho hello\x1b[0m\nhello   \n\n\n\n\nworld";
    const result = sanitize(input, { command: "echo hello" });
    expect(result).toBe("hello\n\nworld");
  });

  it("handles empty input", () => {
    expect(sanitize("")).toBe("");
  });
});
