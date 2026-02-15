# mcp-interactive-terminal

MCP server for interactive shell sessions. Run REPLs, SSH, database clients, and any interactive CLI through AI agents like Claude Code, Cursor, and others.

## The Problem

AI coding agents can't handle interactive commands — no PTY, no stdin streaming. You can't run `rails console`, `python`, `psql`, `ssh`, or any REPL through them.

## The Solution

This MCP server gives AI agents real interactive terminal sessions with clean text output — no raw ANSI escape codes. It supports two modes:

- **PTY mode** (default): Spawns a real pseudo-terminal and renders output through xterm-headless (the same terminal emulator as VS Code). The AI sees exactly what a human would see — cursor-positioned, line-wrapped, clean text. Supports terminal resize, TUI apps (vim, htop, top), arrow keys, tab completion, 256-color, and scrollback.
- **Pipe mode** (automatic fallback): When node-pty can't spawn PTYs (e.g., in Claude Code's OS sandbox), falls back to `child_process.spawn` with pipes. Output is cleaned via ANSI stripping. No terminal emulation, but interactive sessions still work with auto-injected flags (`python -u -i`, `bash -i`, `node --interactive`).

The mode is selected automatically — PTY is tried first, pipe mode kicks in if it fails.

```
AI Agent (Claude Code, Cursor, etc.)
    ↕  MCP (JSON-RPC over stdio)
MCP Terminal Server
    ↕  node-pty (PTY mode) or child_process (pipe mode)
Interactive Process (rails console, python, psql, ssh, bash...)
    ↕  xterm-headless (PTY) or ANSI stripping (pipe)
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
| `MCP_TERMINAL_ALLOWED_PATHS` | (none) | Comma-separated paths sessions can access |
| `MCP_TERMINAL_AUDIT_LOG` | (none) | Path to JSON audit log file |
| `MCP_TERMINAL_SANDBOX` | `false` | Enable OS-level kernel sandboxing |
| `MCP_TERMINAL_SANDBOX_ALLOW_WRITE` | `/tmp` | Writable paths in sandbox mode |
| `MCP_TERMINAL_SANDBOX_ALLOW_NETWORK` | `*` | Allowed network domains in sandbox |

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

### Two Terminal Modes

**PTY mode** (node-pty + xterm-headless) is the default and gives you the full terminal experience:

- Pixel-perfect output — xterm-headless (same engine as VS Code's terminal) renders the screen exactly as a human would see it
- Cursor positioning — programs that overwrite parts of the screen (progress bars, spinners, `\r` overwrites) render correctly, showing only the final state
- Terminal resize — dynamically change `cols` and `rows` mid-session
- TUI/ncurses apps — `vim`, `htop`, `top`, `less`, `tmux` all work because there's a real PTY underneath
- Full keyboard support — arrow keys for command history, tab completion, ctrl+r reverse search, ctrl+c/d/z signals, home/end, and 20+ control keys
- Scrollback buffer — 1000 lines of history via `full_screen: true`
- 256-color support — `TERM=xterm-256color` is set automatically

**Pipe mode** (child_process fallback) activates automatically when PTY spawning is blocked (e.g., in Claude Code's OS sandbox):

- Interactive sessions still work — auto-injects flags like `python -u -i`, `bash -i`, `node --interactive`
- ANSI stripping — escape codes are removed, but no terminal emulation
- Control keys still work — ctrl+c sends SIGINT to the process tree, ctrl+d sends EOF
- Optional OS-level sandboxing via `@anthropic-ai/sandbox-runtime`

### PTY vs Pipe — what the AI sees

| Scenario | PTY mode | Pipe mode |
|----------|----------|-----------|
| `printf "\rProgress: 3/3"` | `Progress: 3/3` | `Progress: 1/3Progress: 2/3Progress: 3/3` |
| `printf "ABCDEF\033[4DXXXX"` | `ABXXXX` | `ABCDEFXXXX` |
| Tabs (`\t`) | Aligned to 8-char stops | Raw `\t` characters |
| ANSI colors `\033[31mred\033[0m` | `red` | `red` |
| `vim`, `htop`, `top` | Readable screen | Garbled escape codes |
| Arrow up (history) | Previous command | Works |
| Tab completion | Works | Works |
| Terminal resize | Works | No-op |

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
