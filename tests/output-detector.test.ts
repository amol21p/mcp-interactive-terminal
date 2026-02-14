import { describe, it, expect } from "vitest";
import { detectPromptPattern, endsWithPrompt } from "../src/utils/output-detector.js";

describe("detectPromptPattern", () => {
  it("detects bash dollar prompt", () => {
    const pattern = detectPromptPattern("Welcome to Ubuntu\nuser@host:~$ ");
    expect(pattern).not.toBeNull();
    expect(pattern!.test("user@host:~$ ")).toBe(true);
  });

  it("detects python REPL prompt", () => {
    const pattern = detectPromptPattern("Python 3.11.0\nType \"help\"\n>>> ");
    expect(pattern).not.toBeNull();
  });

  it("detects zsh percent prompt", () => {
    const pattern = detectPromptPattern("user@host % ");
    expect(pattern).not.toBeNull();
  });

  it("returns null for non-prompt output", () => {
    const pattern = detectPromptPattern("This is just some random output text that is long enough");
    expect(pattern).toBeNull();
  });

  it("returns null for empty output", () => {
    expect(detectPromptPattern("")).toBeNull();
    expect(detectPromptPattern("\n\n\n")).toBeNull();
  });
});

describe("endsWithPrompt", () => {
  it("returns true when output ends with detected prompt", () => {
    const pattern = detectPromptPattern("user@host:~$ ");
    expect(endsWithPrompt("some output\nuser@host:~$ ", pattern)).toBe(true);
  });

  it("returns false when output does not end with prompt", () => {
    const pattern = detectPromptPattern("user@host:~$ ");
    expect(endsWithPrompt("still running...", pattern)).toBe(false);
  });

  it("returns false when no prompt pattern", () => {
    expect(endsWithPrompt("any output", null)).toBe(false);
  });
});
