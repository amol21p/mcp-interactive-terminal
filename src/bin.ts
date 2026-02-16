#!/usr/bin/env node

/**
 * CLI entry point for mcp-interactive-terminal.
 *
 * This file exists separately from index.ts so the Node version check
 * runs BEFORE any module resolution. In ESM, static `import` declarations
 * are hoisted and resolved before any code executes — so a version check
 * placed before imports in the same file would never run on older Node
 * versions that can't parse the imported modules.
 *
 * By using dynamic `import()` here, we guarantee:
 *   1. This file is parsed (valid on Node 14+)
 *   2. The version check runs
 *   3. Only THEN does the real server get loaded
 */

const MIN_NODE_MAJOR = 18;
const MIN_NODE_MINOR = 14;
const MIN_NODE_PATCH = 1;

const [nodeMajor, nodeMinor, nodePatch] = process.versions.node.split(".").map(Number);

if (
  nodeMajor < MIN_NODE_MAJOR ||
  (nodeMajor === MIN_NODE_MAJOR && nodeMinor < MIN_NODE_MINOR) ||
  (nodeMajor === MIN_NODE_MAJOR && nodeMinor === MIN_NODE_MINOR && nodePatch < MIN_NODE_PATCH)
) {
  const current = process.versions.node;
  const required = `${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.${MIN_NODE_PATCH}`;
  console.error("");
  console.error("┌─────────────────────────────────────────────────────────────┐");
  console.error("│  mcp-interactive-terminal: Node.js version too old         │");
  console.error("│                                                             │");
  console.error(`│  Current:  v${current.padEnd(46)}│`);
  console.error(`│  Required: v${required}+${" ".repeat(44 - required.length)}│`);
  console.error("│                                                             │");
  console.error("│  Fix:                                                       │");
  console.error("│    nvm install 22 && nvm use 22                             │");
  console.error("│    volta install node@22                                    │");
  console.error("│    brew install node@22                                     │");
  console.error("│                                                             │");
  console.error("│  If using Claude Code, update your MCP config to use an     │");
  console.error("│  absolute path to a newer npx:                              │");
  console.error('│    "command": "/path/to/node22/bin/npx"                     │');
  console.error("│                                                             │");
  console.error("│  Find your npx path: which npx                              │");
  console.error("└─────────────────────────────────────────────────────────────┘");
  console.error("");
  process.exit(1);
}

// Node version OK — load the real server
await import("./index.js");
