# mcp-interactive-terminal

[![npm version](https://img.shields.io/npm/v/mcp-interactive-terminal.svg)](https://www.npmjs.com/package/mcp-interactive-terminal)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org/)

MCP server that gives AI agents (Claude Code, Cursor, Windsurf, etc.) real interactive terminal sessions. Run REPLs, SSH, database clients, and any interactive CLI — with clean text output, smart completion detection, and 7-layer security.

## Why This Exists

AI coding agents can't handle interactive commands. There's no PTY, no stdin streaming. You can't run `rails console`, `python`, `psql`, `ssh`, or any REPL through them. This MCP server fixes that.

```
AI Agent (Claude Code, Cursor, etc.)
    ↕  MCP (JSON-RPC over stdio)
mcp-interactive-terminal
    ↕  node-pty + xterm-headless
Interactive Process (rails console, python, psql, ssh, bash...)
    ↕
Clean text output (exactly what a human would see)
```

## Install

### Claude Code

```bash
claude mcp add terminal -- npx -y mcp-interactive-terminal
```

That's it. The server is now available. Ask Claude to "open a python REPL and calculate 2**100".

### Cursor

Go to **Settings > MCP Servers**, click **Add Server**, and enter:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "npx",
      "args": ["-y", "mcp-interactive-terminal"]
    }
  }
}
```

### Windsurf

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "npx",
      "args": ["-y", "mcp-interactive-terminal"]
    }
  }
}
```

### VS Code (GitHub Copilot)

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "terminal": {
      "command": "npx",
      "args": ["-y", "mcp-interactive-terminal"]
    }
  }
}
```

### Any MCP Client

The server communicates over stdio using the [Model Context Protocol](https://modelcontextprotocol.io/). Any MCP-compatible client can use it with the same `npx -y mcp-interactive-terminal` command.

## Real-World Examples

### Rails Console

```
You: "Open rails console for staging and check the user count"

Agent creates session → bash
Agent sends: cd /path/to/app && rails console -e staging
Agent sends: User.count
Agent returns: 1,847,293
```

### Python REPL

```
You: "Open python and test my sorting algorithm"

Agent creates session → python3
Agent sends: def quicksort(arr): ...
Agent sends: quicksort([3, 1, 4, 1, 5, 9])
Agent returns: [1, 1, 3, 4, 5, 9]
```

### Database Client

```
You: "Connect to postgres and show me the largest tables"

Agent creates session → psql -U myuser mydb
Agent sends: SELECT tablename, pg_size_pretty(pg_total_relation_size(tablename::text)) ...
Agent returns: formatted table of results
```

### SSH

```
You: "SSH into the staging server and check disk usage"

Agent creates session → ssh user@staging.example.com
Agent sends: df -h
Agent returns: disk usage table
```

### Docker

```
You: "Open a shell in my running container and check the logs"

Agent creates session → docker exec -it my-container bash
Agent sends: tail -100 /var/log/app.log
Agent returns: last 100 log lines
```

### Node.js REPL

```
You: "Open node and test the date parsing logic"

Agent creates session → node
Agent sends: new Date('2024-02-29').toISOString()
Agent returns: 2024-02-29T00:00:00.000Z
```

## Tools

The server exposes 7 MCP tools:

### `create_session` — Spawn an interactive process

```json
{ "command": "python3", "name": "my-python", "cwd": "/project" }
→ { "session_id": "a1b2c3d4", "name": "my-python", "pid": 12345 }
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `command` | Yes | — | Command to run (bash, python3, psql, ssh, etc.) |
| `args` | No | `[]` | Command arguments |
| `name` | No | auto | Human-readable session name |
| `cwd` | No | server cwd | Working directory |
| `env` | No | `{}` | Additional environment variables |
| `cols` | No | `120` | Terminal columns |
| `rows` | No | `40` | Terminal rows |

### `send_command` — Send input and get output

```json
{ "session_id": "a1b2c3d4", "input": "1 + 1" }
→ { "output": "2", "is_complete": true, "is_alive": true }
```

| Parameter | Required | Default | Description |
|-----------|----------|---------|-------------|
| `session_id` | Yes | — | Target session |
| `input` | Yes | — | Command/input to send (newline appended automatically) |
| `timeout_ms` | No | `5000` | Max wait time for output |
| `max_output_chars` | No | `20000` | Truncate output beyond this |

Dangerous commands (`rm -rf`, `DROP TABLE`, `curl|bash`, etc.) are blocked — the agent must use `confirm_dangerous_command` first.

### `read_output` — Read terminal screen (read-only)

```json
{ "session_id": "a1b2c3d4" }
→ { "output": ">>> ", "is_alive": true }
```

Safe to auto-approve — this only reads, never sends input.

### `list_sessions` — List active sessions (read-only)

```json
→ [{ "session_id": "a1b2c3d4", "name": "my-python", "command": "python3", "pid": 12345, "is_alive": true }]
```

Safe to auto-approve.

### `close_session` — Kill a session

```json
{ "session_id": "a1b2c3d4" }
→ { "success": true }
```

### `send_control` — Send control characters

```json
{ "session_id": "a1b2c3d4", "control": "ctrl+c" }
→ { "output": "^C\n>>>" }
```

Supported: `ctrl+c`, `ctrl+d`, `ctrl+z`, `ctrl+l`, `ctrl+r`, `tab`, `escape`, `up`, `down`, `left`, `right`, `enter`, `backspace`, `delete`, `home`, `end`, and more.

### `confirm_dangerous_command` — Two-step safety confirmation

```json
{ "session_id": "a1b2c3d4", "input": "rm -rf /tmp/old", "justification": "Cleaning up stale temp files from failed build" }
→ { "output": "...", "is_complete": true, "is_alive": true }
```

Required when `send_command` detects a dangerous pattern. The agent must explain why the command is necessary. This is a **separate tool** — even if `send_command` is auto-approved, this requires its own permission.

## How It Works

### Two Terminal Modes

**PTY mode** (default) — uses `node-pty` + `@xterm/headless` (the same terminal emulator as VS Code):

- Clean output — the AI sees exactly what a human would see on screen
- Cursor positioning, progress bars, `\r` overwrites all render correctly
- Full keyboard: arrow keys, tab completion, ctrl+c/d/z, home/end
- Terminal resize, TUI apps (vim, htop, top), 256-color, 1000-line scrollback

**Pipe mode** (automatic fallback) — activates when node-pty can't load (e.g., in sandboxed environments):

- Interactive sessions still work via `child_process.spawn` with auto-injected flags (`python -u -i`, `bash -i`, etc.)
- ANSI codes stripped, control keys still work
- No terminal emulation, but covers the basics

The mode is selected automatically — PTY is tried first, pipe mode kicks in if it fails.

### What the AI sees: PTY vs Pipe

| Scenario | PTY mode | Pipe mode |
|----------|----------|-----------|
| `printf "\rProgress: 3/3"` | `Progress: 3/3` | `Progress: 1/3Progress: 2/3Progress: 3/3` |
| ANSI colors | Stripped cleanly | Stripped via regex |
| vim, htop, top | Readable screen | Garbled |
| Arrow keys, tab completion | Works | Works |
| Terminal resize | Works | No-op |

### Smart "Command Done" Detection

Instead of blindly waiting a fixed time, the server uses a layered strategy:

1. **Process exit** — if the process died, command is done
2. **Prompt detection** — auto-detects the session's prompt at startup (bash `$`, python `>>>`, psql `#`, etc.), watches for it to reappear
3. **Output settling** — no new output for 300ms = probably done
4. **Timeout** — always returns after `timeout_ms` with `is_complete: false`

## Security

Seven-layer defense-in-depth:

| Layer | What It Does | Default |
|-------|-------------|---------|
| MCP Tool Annotations | `readOnlyHint`/`destructiveHint` on each tool | Always on |
| Confirmation Flow | Dangerous patterns require `confirm_dangerous_command` | Always on |
| Input Pattern Detection | Detect rm -rf, DROP TABLE, curl\|bash, etc. | Always on |
| Command Blocklist/Allowlist | Block/allow specific commands | Configurable |
| OS-Level Sandbox | Kernel-level process sandboxing via `@anthropic-ai/sandbox-runtime` | Off (opt-in) |
| Secret Redaction | Redact AWS keys, tokens, private keys in output | Off (opt-in) |
| Resource Limits | Max sessions, output cap, idle timeout, audit logging | Always on |

### Recommended Permissions

Only auto-approve the read-only tools:

```json
{
  "permissions": {
    "allow": [
      "mcp__terminal__list_sessions",
      "mcp__terminal__read_output"
    ]
  }
}
```

This way `send_command`, `create_session`, and especially `confirm_dangerous_command` always require human approval.

## Configuration

All settings via environment variables. Pass them in your MCP config:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "npx",
      "args": ["-y", "mcp-interactive-terminal"],
      "env": {
        "MCP_TERMINAL_ALLOWED_COMMANDS": "bash,python3,node,psql",
        "MCP_TERMINAL_REDACT_SECRETS": "true",
        "MCP_TERMINAL_IDLE_TIMEOUT": "300000"
      }
    }
  }
}
```

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TERMINAL_MAX_SESSIONS` | `10` | Max concurrent sessions |
| `MCP_TERMINAL_MAX_OUTPUT` | `20000` | Max output chars per read |
| `MCP_TERMINAL_DEFAULT_TIMEOUT` | `5000` | Default wait timeout (ms) |
| `MCP_TERMINAL_BLOCKED_COMMANDS` | — | Comma-separated blocklist |
| `MCP_TERMINAL_ALLOWED_COMMANDS` | — | Comma-separated allowlist (if set, only these are allowed) |
| `MCP_TERMINAL_ALLOWED_PATHS` | — | Comma-separated paths sessions can access |
| `MCP_TERMINAL_REDACT_SECRETS` | `false` | Redact AWS keys, tokens, private keys in output |
| `MCP_TERMINAL_LOG_INPUTS` | `false` | Log all inputs to stderr (for debugging) |
| `MCP_TERMINAL_IDLE_TIMEOUT` | `1800000` | Auto-close idle sessions (ms, default 30min, 0 = disabled) |
| `MCP_TERMINAL_DANGER_DETECTION` | `true` | Enable dangerous command confirmation flow |
| `MCP_TERMINAL_AUDIT_LOG` | — | Path to JSON audit log file |
| `MCP_TERMINAL_SANDBOX` | `false` | Enable OS-level kernel sandboxing |
| `MCP_TERMINAL_SANDBOX_ALLOW_WRITE` | `/tmp` | Writable paths in sandbox mode |
| `MCP_TERMINAL_SANDBOX_ALLOW_NETWORK` | `*` | Allowed network domains in sandbox |

## Troubleshooting

### "Tools not showing up" / Server fails silently

MCP servers that fail to start often show no error in the client. Check:

```bash
# Test the server directly:
npx -y mcp-interactive-terminal

# You should see "[mcp-terminal] Starting MCP Interactive Terminal Server" on stderr.
# If you see an error, that's what's failing.
```

### Node.js version too old

The server requires Node.js >= 18. If you see errors about unsupported syntax or missing APIs:

```bash
node --version  # Must be >= 18

# If using nvm:
nvm install 18 && nvm use 18

# If using volta:
volta install node@18
```

**For nvm/volta/fnm users**: `npx` may use a different Node version than your shell. Use an absolute path:

```json
{
  "mcpServers": {
    "terminal": {
      "command": "/Users/you/.nvm/versions/node/v22.0.0/bin/npx",
      "args": ["-y", "mcp-interactive-terminal"]
    }
  }
}
```

Find your path with: `which npx`

### node-pty compilation errors

`node-pty` is a native module that requires build tools. If it fails to compile, the server automatically falls back to **pipe mode** — interactive sessions still work, just without terminal emulation.

If you want full PTY support:

```bash
# macOS:
xcode-select --install

# Ubuntu/Debian:
sudo apt-get install -y make python3 build-essential

# RHEL/Fedora:
sudo yum install -y make python3 gcc gcc-c++
```

### Session dies immediately

Some commands need to be run inside a shell rather than directly:

```
# Instead of:  create_session({ command: "rails console -e staging" })
# Do this:     create_session({ command: "bash" })
#              send_command({ input: "rails console -e staging" })
```

This is because `create_session` runs the command directly (like `exec`), not through a shell. Spawning `bash` first gives you a full shell environment.

### Output looks garbled

If output contains escape codes or looks wrong, you're likely in **pipe mode** (node-pty failed to load). Check the server logs for `"falling back to pipe mode"`. Install build tools (see above) to enable PTY mode.

### Timeout too short for long-running commands

Increase the timeout per-command:

```json
{ "session_id": "...", "input": "bundle install", "timeout_ms": 60000 }
```

Or globally via environment variable:

```json
{ "env": { "MCP_TERMINAL_DEFAULT_TIMEOUT": "30000" } }
```

## Comparison with Alternatives

| Feature | mcp-interactive-terminal | App-specific terminal servers | Generic shell MCP servers |
|---------|------------------------|-------------------------------|--------------------------|
| Cross-platform | Yes | Often single-app only | Varies |
| Clean output (xterm-headless) | Yes | No (screen scrape) | No (raw PTY dump) |
| Smart completion detection | 4-layer algorithm | No | Basic timeout |
| Security layers | 7 (confirmation flow, sandbox, redaction, etc.) | None | Basic |
| Dangerous command confirmation | Yes (separate tool) | No | No |
| MCP tool annotations | Yes | No | No |
| Background sessions | Yes | No (uses active tab) | Yes |
| Focused API | 7 tools | 2-3 tools | 15-20+ tools (scope creep) |
| Install | `npx -y` (zero-config) | Requires specific app | Varies |

## Development

```bash
git clone https://github.com/amol21p/mcp-interactive-terminal.git
cd mcp-interactive-terminal
npm install
npm run build
npm test
```

Test with MCP Inspector:

```bash
npx @modelcontextprotocol/inspector dist/index.js
```

## License

MIT
