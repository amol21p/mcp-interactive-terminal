# mcp-interactive-terminal

MCP server for interactive shell sessions. Run REPLs, SSH, database clients, and any interactive CLI through AI agents like Claude Code, Cursor, and others.

## The Problem

AI coding agents can't handle interactive commands — no PTY, no stdin streaming. You can't run `rails console`, `python`, `psql`, `ssh`, or any REPL through them.

## The Solution

This MCP server spawns real pseudo-terminals (PTY) and uses xterm-headless (the same terminal emulator as VS Code) to render clean text output. The AI sees exactly what a human would see — no raw ANSI escape codes.

```
AI Agent (Claude Code, Cursor, etc.)
    ↕  MCP (JSON-RPC over stdio)
MCP Terminal Server
    ↕  node-pty (pseudo-terminal)
Interactive Process (rails console, python, psql, ssh, bash...)
    ↕  xterm-headless (terminal emulation)
Clean text output
```

## Quick Start

### Claude Code

```bash
claude mcp add terminal -- npx -y mcp-interactive-terminal
```

### Manual Configuration

Add to `~/.claude.json` or `.mcp.json`:

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

## Tools

### `create_session` — Spawn an interactive process

```json
{ "command": "python3", "name": "my-python", "cwd": "/project" }
→ { "session_id": "a1b2c3d4", "name": "my-python", "pid": 12345 }
```

**Parameters:** `command` (required), `args?`, `name?`, `cwd?`, `env?`, `cols?` (default 120), `rows?` (default 40)

### `send_command` — Send input and get output

```json
{ "session_id": "a1b2c3d4", "input": "1 + 1" }
→ { "output": "2", "is_complete": true, "is_alive": true }
```

**Parameters:** `session_id`, `input`, `timeout_ms?` (default 5000), `max_output_chars?`

Dangerous commands (rm -rf, DROP TABLE, curl|bash, etc.) are blocked and require `confirm_dangerous_command` first.

### `read_output` — Read terminal screen (read-only)

```json
{ "session_id": "a1b2c3d4" }
→ { "output": ">>> ", "is_alive": true }
```

**Parameters:** `session_id`, `full_screen?` (default false)

### `list_sessions` — List active sessions (read-only)

```json
→ [{ "session_id": "a1b2c3d4", "name": "my-python", "command": "python3", "pid": 12345, "is_alive": true, "created_at": "..." }]
```

### `close_session` — Kill a session

```json
{ "session_id": "a1b2c3d4" }
→ { "success": true }
```

**Parameters:** `session_id`, `signal?` (default SIGTERM)

### `send_control` — Send control characters

```json
{ "session_id": "a1b2c3d4", "control": "ctrl+c" }
→ { "output": "^C\n>>>" }
```

**Supported keys:** ctrl+c, ctrl+d, ctrl+z, ctrl+l, ctrl+r, tab, escape, up, down, left, right, enter, backspace, delete, home, end, and more.

### `confirm_dangerous_command` — Two-step safety confirmation

```json
{ "session_id": "a1b2c3d4", "input": "rm -rf /tmp/old", "justification": "Cleaning up stale temp files from failed build" }
→ { "output": "...", "is_complete": true, "is_alive": true }
```

Required when `send_command` detects a dangerous pattern. The AI must provide a justification.

## Security

Seven-layer defense-in-depth model:

| Layer | What It Does | Default |
|-------|-------------|---------|
| MCP Tool Annotations | `readOnlyHint`/`destructiveHint` on each tool | Always on |
| Confirmation flow | Dangerous patterns require `confirm_dangerous_command` | Always on |
| Input pattern detection | Detect rm -rf, DROP TABLE, curl\|bash, etc. | Always on |
| Command blocklist/allowlist | Block/allow specific commands | Configurable |
| OS-level sandbox | Kernel-level process sandboxing | Off (opt-in) |
| Secret redaction | Redact AWS keys, tokens, private keys in output | Off (opt-in) |
| Resource limits | Max sessions, output cap, idle timeout | Always on |

**Recommended permission configuration** — only auto-approve read-only tools:

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

## Configuration

All configuration via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_TERMINAL_MAX_SESSIONS` | `10` | Max concurrent sessions |
| `MCP_TERMINAL_MAX_OUTPUT` | `20000` | Max output chars per read |
| `MCP_TERMINAL_DEFAULT_TIMEOUT` | `5000` | Default wait timeout (ms) |
| `MCP_TERMINAL_BLOCKED_COMMANDS` | (none) | Comma-separated blocklist |
| `MCP_TERMINAL_ALLOWED_COMMANDS` | (none) | Comma-separated allowlist |
| `MCP_TERMINAL_REDACT_SECRETS` | `false` | Redact detected secrets |
| `MCP_TERMINAL_LOG_INPUTS` | `false` | Log all inputs to stderr |
| `MCP_TERMINAL_IDLE_TIMEOUT` | `0` | Auto-close idle sessions (ms, 0=disabled) |
| `MCP_TERMINAL_DANGER_DETECTION` | `true` | Enable dangerous command detection |

Example with env vars:

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

## How It Works

### Clean Output via xterm-headless

Instead of dumping raw ANSI escape codes, PTY output is fed into xterm-headless (the same terminal emulator used by VS Code, but headless). The buffer is read as plain text — properly wrapped, cursor-positioned, clean.

### Smart "Command Done" Detection

Layered strategy (most to least reliable):

1. **Process exit** — If the process died, command is done
2. **Prompt detection** — Auto-detects the session's prompt at startup (bash `$`, python `>>>`, psql `#`, etc.), watches for it to reappear
3. **Output settling** — No new output for 300ms
4. **Timeout** — Always returns after `timeout_ms` with `is_complete: false`

## Development

```bash
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
