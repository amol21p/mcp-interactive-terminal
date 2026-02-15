#!/usr/bin/env node

/**
 * Comprehensive E2E test suite for mcp-interactive-terminal.
 * Tests via the MCP JSON-RPC protocol, exactly as Claude Code would use it.
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "..", "dist", "index.js");

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

// ─── MCP Client Helper ──────────────────────────────────────────────

function createMCPClient() {
  const server = spawn("node", [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      MCP_TERMINAL_MAX_SESSIONS: "10",
      MCP_TERMINAL_REDACT_SECRETS: "true",
      MCP_TERMINAL_DANGER_DETECTION: "true",
    },
  });

  const responses = new Map();
  let buffer = "";
  let nextId = 1;

  server.stdout.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line);
          if (msg.id) responses.set(msg.id, msg);
        } catch {}
      }
    }
  });

  server.stderr.on("data", () => {});

  async function call(method, params = {}) {
    const id = nextId++;
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    const start = Date.now();
    while (Date.now() - start < 30000) {
      if (responses.has(id)) {
        const resp = responses.get(id);
        responses.delete(id);
        return resp;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Timeout waiting for response to ${method} (id=${id})`);
  }

  async function init() {
    await call("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "e2e-test", version: "1.0.0" },
    });
    server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }

  async function createSession(args) {
    const r = await call("tools/call", { name: "create_session", arguments: args });
    const text = r.result.content[0].text;
    if (r.result.isError) throw new Error(text);
    return JSON.parse(text);
  }

  async function sendCommand(sessionId, input, timeoutMs = 8000) {
    const r = await call("tools/call", {
      name: "send_command",
      arguments: { session_id: sessionId, input, timeout_ms: timeoutMs },
    });
    const text = r.result.content[0].text;
    if (r.result?.isError) return { output: text, is_complete: false, is_alive: false, error: true };
    try {
      return JSON.parse(text);
    } catch {
      return { output: text, is_complete: false, is_alive: false, error: true };
    }
  }

  async function readOutput(sessionId, fullScreen = false) {
    const r = await call("tools/call", {
      name: "read_output",
      arguments: { session_id: sessionId, full_screen: fullScreen },
    });
    return JSON.parse(r.result.content[0].text);
  }

  async function listSessions() {
    const r = await call("tools/call", { name: "list_sessions", arguments: {} });
    return JSON.parse(r.result.content[0].text);
  }

  async function closeSession(sessionId, signal) {
    const args = { session_id: sessionId };
    if (signal) args.signal = signal;
    const r = await call("tools/call", { name: "close_session", arguments: args });
    const text = r.result.content[0].text;
    try {
      return JSON.parse(text);
    } catch {
      return { success: false, error: text };
    }
  }

  async function sendControl(sessionId, control) {
    const r = await call("tools/call", {
      name: "send_control",
      arguments: { session_id: sessionId, control },
    });
    const text = r.result.content[0].text;
    try {
      return JSON.parse(text);
    } catch {
      return { output: text };
    }
  }

  async function confirmDangerous(sessionId, input, justification) {
    const r = await call("tools/call", {
      name: "confirm_dangerous_command",
      arguments: { session_id: sessionId, input, justification },
    });
    const text = r.result.content[0].text;
    if (r.result?.isError) return { output: text, error: true };
    try {
      return JSON.parse(text);
    } catch {
      return { output: text, error: true };
    }
  }

  function kill() {
    server.kill();
  }

  return { init, createSession, sendCommand, readOutput, listSessions, closeSession, sendControl, confirmDangerous, kill };
}

// ─── Test Runner ─────────────────────────────────────────────────────

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(`Assertion failed: ${msg}`);
}

// ─── Test Suites ─────────────────────────────────────────────────────

async function runTests() {
  const client = createMCPClient();
  await client.init();

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 1. Basic Shell Sessions ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Bash: echo command", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-echo" });
    const r = await client.sendCommand(s.session_id, "echo hello_from_bash");
    assert(r.output.includes("hello_from_bash"), `Expected 'hello_from_bash' in: ${r.output}`);
    assert(r.is_alive, "Session should be alive");
    await client.closeSession(s.session_id);
  });

  await test("Bash: environment variables", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-env" });
    const r = await client.sendCommand(s.session_id, "echo $HOME");
    assert(r.output.includes("/Users/"), `Expected home dir in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Bash: pipes and redirects", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-pipes" });
    const r = await client.sendCommand(s.session_id, "echo 'line1\nline2\nline3' | wc -l");
    assert(r.output.trim().includes("3"), `Expected 3 lines in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Bash: command substitution", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-subst" });
    const r = await client.sendCommand(s.session_id, "echo \"today is $(date +%Y)\"");
    assert(r.output.includes("2026") || r.output.includes("today is"), `Expected year in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Bash: multi-line for loop", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-multiline" });
    const r = await client.sendCommand(s.session_id, "for i in 1 2 3; do echo \"num:$i\"; done");
    assert(r.output.includes("num:1"), `Expected num:1 in: ${r.output}`);
    assert(r.output.includes("num:3"), `Expected num:3 in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Bash: working directory (cwd)", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-cwd", cwd: "/tmp" });
    const r = await client.sendCommand(s.session_id, "pwd");
    assert(r.output.includes("/tmp") || r.output.includes("/private/tmp"), `Expected /tmp in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Bash: custom env vars", async () => {
    const s = await client.createSession({
      command: "bash",
      name: "bash-customenv",
      env: { MY_TEST_VAR: "secret_value_42" },
    });
    const r = await client.sendCommand(s.session_id, "echo $MY_TEST_VAR");
    assert(r.output.includes("secret_value_42"), `Expected env var in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Bash: exit code detection", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-exit" });
    const r = await client.sendCommand(s.session_id, "false; echo \"exit_code:$?\"");
    assert(r.output.includes("exit_code:1"), `Expected exit_code:1 in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 2. Python REPL ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Python: basic expression", async () => {
    const s = await client.createSession({ command: "python3", name: "py-basic" });
    const r = await client.sendCommand(s.session_id, "print(2 ** 100)");
    assert(r.output.includes("1267650600228229401496703205376"), `Expected 2**100 in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Python: multi-turn state persistence", async () => {
    const s = await client.createSession({ command: "python3", name: "py-state" });
    await client.sendCommand(s.session_id, "x = 42");
    await client.sendCommand(s.session_id, "y = 58");
    const r = await client.sendCommand(s.session_id, "print(x + y)");
    assert(r.output.includes("100"), `Expected 100 in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Python: import and use module", async () => {
    const s = await client.createSession({ command: "python3", name: "py-import" });
    const r = await client.sendCommand(s.session_id, "import json; print(json.dumps({'key': 'value'}))");
    assert(r.output.includes('"key"'), `Expected JSON in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Python: class definition across commands", async () => {
    const s = await client.createSession({ command: "python3", name: "py-class" });
    await client.sendCommand(s.session_id, "class Foo:\n  def bar(self): return 'baz'\n");
    const r = await client.sendCommand(s.session_id, "print(Foo().bar())");
    assert(r.output.includes("baz"), `Expected 'baz' in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Python: error handling (ZeroDivisionError)", async () => {
    const s = await client.createSession({ command: "python3", name: "py-error" });
    const r = await client.sendCommand(s.session_id, "1/0");
    assert(r.output.includes("ZeroDivisionError"), `Expected ZeroDivisionError in: ${r.output}`);
    assert(r.is_alive, "Session should survive errors");
    await client.closeSession(s.session_id);
  });

  await test("Python: list comprehension", async () => {
    const s = await client.createSession({ command: "python3", name: "py-listcomp" });
    const r = await client.sendCommand(s.session_id, "print([i**2 for i in range(5)])");
    assert(r.output.includes("[0, 1, 4, 9, 16]"), `Expected squares in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 3. Node.js REPL ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Node: basic expression", async () => {
    const s = await client.createSession({ command: "node", name: "node-basic" });
    const r = await client.sendCommand(s.session_id, "console.log(Math.PI.toFixed(5))");
    assert(r.output.includes("3.14159"), `Expected PI in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Node: state persistence", async () => {
    const s = await client.createSession({ command: "node", name: "node-state" });
    await client.sendCommand(s.session_id, "const arr = [1,2,3]");
    const r = await client.sendCommand(s.session_id, "console.log(arr.map(x => x*10))");
    assert(r.output.includes("10") && r.output.includes("30"), `Expected mapped array in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Node: require module", async () => {
    const s = await client.createSession({ command: "node", name: "node-require" });
    const r = await client.sendCommand(s.session_id, "console.log(require('os').platform())");
    assert(r.output.includes("darwin") || r.output.includes("linux"), `Expected platform in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 4. Network Commands ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("curl: HTTP GET status code", async () => {
    const s = await client.createSession({ command: "bash", name: "curl-test" });
    const r = await client.sendCommand(s.session_id, "curl -s -o /dev/null -w '%{http_code}' https://httpbin.org/get", 15000);
    assert(r.output.includes("200"), `Expected 200 in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("curl: JSON piped to python", async () => {
    const s = await client.createSession({ command: "bash", name: "curl-json" });
    const r = await client.sendCommand(s.session_id, "curl -s https://httpbin.org/json | python3 -c \"import sys,json; d=json.load(sys.stdin); print(d['slideshow']['title'])\"", 15000);
    assert(r.output.includes("Sample"), `Expected 'Sample' in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Python: HTTP request with urllib", async () => {
    const s = await client.createSession({ command: "python3", name: "py-http" });
    const r = await client.sendCommand(
      s.session_id,
      "import urllib.request; r = urllib.request.urlopen('https://httpbin.org/get'); print(r.status)",
      15000,
    );
    assert(r.output.includes("200"), `Expected 200 in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 5. File System Operations ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Bash: create, read, delete file", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-file", cwd: "/tmp" });
    await client.sendCommand(s.session_id, "echo 'test_content_xyz' > /tmp/mcp_test_file.txt");
    const r = await client.sendCommand(s.session_id, "cat /tmp/mcp_test_file.txt");
    assert(r.output.includes("test_content_xyz"), `Expected file content in: ${r.output}`);
    await client.sendCommand(s.session_id, "rm /tmp/mcp_test_file.txt");
    await client.closeSession(s.session_id);
  });

  await test("Bash: directory listing", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-ls" });
    const r = await client.sendCommand(s.session_id, "ls /tmp | head -5");
    assert(r.output.length > 0, "Expected some output from ls");
    await client.closeSession(s.session_id);
  });

  await test("Python: file I/O", async () => {
    const s = await client.createSession({ command: "python3", name: "py-fileio" });
    await client.sendCommand(s.session_id, "open('/tmp/mcp_py_test.txt', 'w').write('python_wrote_this')");
    const r = await client.sendCommand(s.session_id, "print(open('/tmp/mcp_py_test.txt').read())");
    assert(r.output.includes("python_wrote_this"), `Expected file content in: ${r.output}`);
    await client.sendCommand(s.session_id, "import os; os.unlink('/tmp/mcp_py_test.txt')");
    await client.closeSession(s.session_id);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 6. Control Characters ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Ctrl+C: interrupt long-running command", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-ctrlc" });
    // Start a long sleep (non-blocking call, won't wait for completion)
    const sleepPromise = client.sendCommand(s.session_id, "sleep 100", 2000);
    // Wait a bit, then send ctrl+c
    await new Promise((r) => setTimeout(r, 800));
    await client.sendControl(s.session_id, "ctrl+c");
    // Wait for the sleep command to return (it should be interrupted)
    await sleepPromise;
    await new Promise((r) => setTimeout(r, 500));
    // Session should still be alive — send another command
    const r = await client.sendCommand(s.session_id, "echo 'recovered'");
    assert(r.output.includes("recovered"), `Expected 'recovered' after ctrl+c: ${JSON.stringify(r.output)}`);
    await client.closeSession(s.session_id);
  });

  await test("Ctrl+D: send EOF to Python", async () => {
    const s = await client.createSession({ command: "python3", name: "py-ctrld" });
    await client.sendCommand(s.session_id, "print('before_eof')");
    await client.sendControl(s.session_id, "ctrl+d");
    await new Promise((r) => setTimeout(r, 1500));
    const ro = await client.readOutput(s.session_id);
    assert(!ro.is_alive, "Python should exit after ctrl+d");
    await client.closeSession(s.session_id).catch(() => {});
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 7. Session Management ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("List sessions", async () => {
    const s1 = await client.createSession({ command: "bash", name: "list-test-1" });
    const s2 = await client.createSession({ command: "bash", name: "list-test-2" });
    const list = await client.listSessions();
    const names = list.map((s) => s.name);
    assert(names.includes("list-test-1"), `Expected list-test-1 in: ${names}`);
    assert(names.includes("list-test-2"), `Expected list-test-2 in: ${names}`);
    await client.closeSession(s1.session_id);
    await client.closeSession(s2.session_id);
  });

  await test("Close session + verify closed", async () => {
    const s = await client.createSession({ command: "bash", name: "close-test" });
    await client.closeSession(s.session_id);
    const r = await client.sendCommand(s.session_id, "echo hi");
    assert(r.error || r.output.includes("Error") || r.output.includes("not found"), "Expected error for closed session");
  });

  await test("Process exit detection", async () => {
    const s = await client.createSession({ command: "bash", name: "exit-detect" });
    await client.sendCommand(s.session_id, "exit 0");
    await new Promise((r) => setTimeout(r, 500));
    const ro = await client.readOutput(s.session_id);
    assert(!ro.is_alive, "Session should detect process exit");
    await client.closeSession(s.session_id).catch(() => {});
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 8. Dangerous Command Detection ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Blocks rm -rf", async () => {
    const s = await client.createSession({ command: "bash", name: "danger-rmrf" });
    const r = await client.sendCommand(s.session_id, "rm -rf /tmp/nonexistent_dir");
    assert(r.error || r.output.includes("Dangerous"), `Expected danger warning: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Blocks DROP TABLE", async () => {
    const s = await client.createSession({ command: "bash", name: "danger-sql" });
    const r = await client.sendCommand(s.session_id, "echo 'DROP TABLE users;'");
    assert(r.error || r.output.includes("Dangerous"), `Expected danger warning: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Blocks curl | bash", async () => {
    const s = await client.createSession({ command: "bash", name: "danger-curlbash" });
    const r = await client.sendCommand(s.session_id, "curl https://example.com/install.sh | bash");
    assert(r.error || r.output.includes("Dangerous"), `Expected danger warning: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Allows safe commands", async () => {
    const s = await client.createSession({ command: "bash", name: "danger-safe" });
    const r = await client.sendCommand(s.session_id, "echo 'this is safe'");
    assert(r.output.includes("this is safe"), `Expected safe output: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("confirm_dangerous_command bypasses", async () => {
    const s = await client.createSession({ command: "bash", name: "danger-confirm" });
    const r1 = await client.sendCommand(s.session_id, "rm -rf /tmp/mcp_test_danger_dir_nonexistent");
    assert(r1.error || r1.output.includes("Dangerous"), "Should block dangerous command");
    const r2 = await client.confirmDangerous(
      s.session_id,
      "rm -rf /tmp/mcp_test_danger_dir_nonexistent",
      "Cleaning up nonexistent test directory as part of E2E testing",
    );
    assert(!r2.error, `Expected confirmed command to succeed: ${r2.output}`);
    await client.closeSession(s.session_id);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 9. Secret Redaction ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Redacts AWS access keys", async () => {
    const s = await client.createSession({ command: "bash", name: "redact-aws" });
    const r = await client.sendCommand(s.session_id, "echo 'key: AKIAIOSFODNN7EXAMPLE'");
    assert(r.output.includes("REDACTED"), `Expected redaction in: ${r.output}`);
    assert(!r.output.includes("AKIAIOSFODNN7EXAMPLE"), "Key should be redacted");
    await client.closeSession(s.session_id);
  });

  await test("Redacts GitHub PATs", async () => {
    const s = await client.createSession({ command: "bash", name: "redact-gh" });
    const r = await client.sendCommand(s.session_id, "echo 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12345'");
    assert(r.output.includes("REDACTED"), `Expected redaction in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Redacts private key headers", async () => {
    const s = await client.createSession({ command: "bash", name: "redact-pkey" });
    const r = await client.sendCommand(s.session_id, "echo '-----BEGIN RSA PRIVATE KEY-----'");
    assert(r.output.includes("REDACTED"), `Expected redaction in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Leaves clean output alone", async () => {
    const s = await client.createSession({ command: "bash", name: "redact-clean" });
    const r = await client.sendCommand(s.session_id, "echo 'no secrets here'");
    assert(!r.output.includes("REDACTED"), `Should not redact: ${r.output}`);
    assert(r.output.includes("no secrets here"), `Expected clean output: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 10. Large & Varied Output ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Large sequential output (500 lines)", async () => {
    const s = await client.createSession({ command: "bash", name: "bash-large" });
    const r = await client.sendCommand(s.session_id, "seq 1 500");
    assert(r.output.includes("1"), `Expected first number`);
    assert(r.output.includes("500"), `Expected last number`);
    await client.closeSession(s.session_id);
  });

  await test("Python: large computation (2^10000 digits)", async () => {
    const s = await client.createSession({ command: "python3", name: "py-large" });
    const r = await client.sendCommand(s.session_id, "print(len(str(2**10000)))", 10000);
    assert(r.output.includes("3011"), `Expected 3011 digits: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 11. Output Scoping ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Each command returns only new output", async () => {
    const s = await client.createSession({ command: "bash", name: "scope-test" });
    const r1 = await client.sendCommand(s.session_id, "echo 'FIRST_OUTPUT'");
    assert(r1.output.includes("FIRST_OUTPUT"), `CMD1 should have FIRST_OUTPUT`);

    const r2 = await client.sendCommand(s.session_id, "echo 'SECOND_OUTPUT'");
    assert(r2.output.includes("SECOND_OUTPUT"), `CMD2 should have SECOND_OUTPUT`);
    assert(!r2.output.includes("FIRST_OUTPUT"), `CMD2 should NOT repeat FIRST_OUTPUT`);

    const r3 = await client.sendCommand(s.session_id, "echo 'THIRD_OUTPUT'");
    assert(r3.output.includes("THIRD_OUTPUT"), `CMD3 should have THIRD_OUTPUT`);
    assert(!r3.output.includes("SECOND_OUTPUT"), `CMD3 should NOT repeat SECOND_OUTPUT`);

    await client.closeSession(s.session_id);
  });

  await test("full_screen returns all history", async () => {
    const s = await client.createSession({ command: "bash", name: "fullscreen-test" });
    await client.sendCommand(s.session_id, "echo 'AAA'");
    await client.sendCommand(s.session_id, "echo 'BBB'");
    await client.sendCommand(s.session_id, "echo 'CCC'");
    const ro = await client.readOutput(s.session_id, true);
    assert(ro.output.includes("AAA"), "Full screen should have AAA");
    assert(ro.output.includes("BBB"), "Full screen should have BBB");
    assert(ro.output.includes("CCC"), "Full screen should have CCC");
    await client.closeSession(s.session_id);
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 12. Edge Cases ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("Unicode output", async () => {
    const s = await client.createSession({ command: "bash", name: "unicode" });
    const r = await client.sendCommand(s.session_id, "echo '日本語テスト'");
    assert(r.output.includes("日本語テスト"), `Expected unicode in: ${r.output}`);
    await client.closeSession(s.session_id);
  });

  await test("Empty command", async () => {
    const s = await client.createSession({ command: "bash", name: "empty-cmd" });
    const r = await client.sendCommand(s.session_id, "");
    assert(r.is_alive, "Session should survive empty command");
    await client.closeSession(s.session_id);
  });

  await test("Rapid sequential commands (5x)", async () => {
    const s = await client.createSession({ command: "python3", name: "py-rapid" });
    const results = [];
    for (let i = 0; i < 5; i++) {
      const r = await client.sendCommand(s.session_id, `print(${i})`, 3000);
      results.push(r.output);
    }
    for (let i = 0; i < 5; i++) {
      assert(results[i].includes(String(i)), `Expected ${i} in result ${i}: ${results[i]}`);
    }
    await client.closeSession(s.session_id);
  });

  await test("Invalid session ID", async () => {
    const r = await client.sendCommand("nonexistent_id_xyz", "echo hi");
    assert(r.error || r.output.includes("not found"), `Expected error: ${r.output}`);
  });

  await test("Invalid command spawn", async () => {
    try {
      const s = await client.createSession({ command: "this_command_does_not_exist_xyz123" });
      // If we get here without error, the process should be dead
      const ro = await client.readOutput(s.session_id);
      assert(!ro.is_alive, "Process with invalid command should be dead");
      await client.closeSession(s.session_id).catch(() => {});
    } catch (e) {
      // Expected — spawn failure
      assert(true, "Caught expected error");
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 13. bash -c Wrapper ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("bash -c: no -i injection, no job control warning", async () => {
    const s = await client.createSession({
      command: "bash",
      args: ["-c", "echo 'wrapper_test_ok'"],
      name: "bash-c-wrapper",
    });
    const ro = await client.readOutput(s.session_id, true);
    assert(!ro.output.includes("no job control"), `Should not have job control warning: ${ro.output}`);
    assert(ro.output.includes("wrapper_test_ok"), `Expected output: ${ro.output}`);
    await client.closeSession(s.session_id).catch(() => {});
  });

  // ═══════════════════════════════════════════════════════════════════
  console.log("\n── 14. Concurrent Sessions ──");
  // ═══════════════════════════════════════════════════════════════════

  await test("3 concurrent sessions with different commands", async () => {
    const sessions = await Promise.all([
      client.createSession({ command: "bash", name: "conc-bash" }),
      client.createSession({ command: "python3", name: "conc-python" }),
      client.createSession({ command: "node", name: "conc-node" }),
    ]);

    const results = await Promise.all([
      client.sendCommand(sessions[0].session_id, "echo 'bash_ok'"),
      client.sendCommand(sessions[1].session_id, "print('python_ok')"),
      client.sendCommand(sessions[2].session_id, "console.log('node_ok')"),
    ]);

    assert(results[0].output.includes("bash_ok"), `Bash output: ${results[0].output}`);
    assert(results[1].output.includes("python_ok"), `Python output: ${results[1].output}`);
    assert(results[2].output.includes("node_ok"), `Node output: ${results[2].output}`);

    for (const s of sessions) {
      await client.closeSession(s.session_id);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // Cleanup
  // ═══════════════════════════════════════════════════════════════════

  try {
    const remaining = await client.listSessions();
    for (const s of remaining) {
      await client.closeSession(s.session_id).catch(() => {});
    }
  } catch {}

  client.kill();

  console.log(`\n${"═".repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failures.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failures) {
      console.log(`  ✗ ${f.name}: ${f.error}`);
    }
  }
  console.log(`${"═".repeat(60)}`);

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
