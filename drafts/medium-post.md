# I Built an MCP Server That Lets AI Agents Use Interactive Terminals — Here's Why It Matters

<!-- HERO IMAGE: Upload drafts/images/hero-banner.png as the cover image -->

If you've used AI coding agents like Claude Code, Cursor, or GitHub Copilot, you know they can run shell commands. But that's basically it. Every command is fire-and-forget — the agent runs something, gets the output, and the process is gone forever. There's no way to go back to it, no way to wait for it, no interactivity at all.

This sounds like a minor thing until you notice the workarounds your agent is forced to do constantly.

## The Problem

**Want to test something quickly?** The agent can't keep a REPL open. So it writes a throwaway Python script, runs it, reads the output, cleans up. For every small experiment. You end up with a trail of temporary scripts and log files for things that would take 10 seconds in an interactive session.

**Need to check something in your database?** The agent can't hold a psql or mysql session open. So every single query becomes a one-liner: `psql -c "SELECT ..."` — a fresh connection each time. Want to explore a schema, then run a few queries based on what you see? That's 5 separate connect-query-disconnect cycles instead of one session.

**Working with a dev server?** The agent starts it, but then it's gone. Need to interact with it? Start it again. Need to check logs while it's running? Can't — the process handle disappeared. Need to run tests *against* a running server? The agent has to figure out how to start the server in the background, hope it's ready, run the command, then clean up.

The root issue: **there's no persistent session**. Every command spawns a new process that immediately exits. No stdin streaming, no PTY, no way to have a back-and-forth conversation with a running process.

So I built **mcp-interactive-terminal**.

## What It Does

It's an MCP (Model Context Protocol) server that gives AI agents real, persistent terminal sessions. The agent can open a session with any command — bash, python3, psql, ssh, node, whatever — send commands, wait for output, send more commands, and the session stays alive between interactions. Like how you'd actually use a terminal.

<!-- IMAGE: Upload drafts/images/architecture.png -->
*How it works: AI agent communicates via MCP, the server manages persistent PTY sessions with any interactive process.*

## Real-World Use Cases

Here's where this actually changes the workflow:

### 1. REPL Experiments

"Open python and test this email regex against these 5 strings."

The agent opens one REPL session, iterates through all test cases, sees which pass and which fail, and gives you a summary with a suggested fix. No throwaway scripts, no temp files.

<!-- IMAGE: Upload drafts/images/screenshot-repl.png -->
*The agent opens a Python REPL, tests a regex against multiple inputs in the same session, and reports results with a suggested improvement.*

### 2. Database Exploration

"Connect to staging postgres, show me the largest tables, then count this week's signups."

One psql session, multiple queries, one connection. The agent builds on what it sees — if the schema has a column called `revenue_cents`, it uses that in the next query. Without persistent sessions, each query would be blind to what came before.

<!-- IMAGE: Upload drafts/images/screenshot-database.png -->
*Two queries in the same psql session. The agent connects once and runs multiple commands without reconnecting.*

### 3. SSH + Remote Debugging

"SSH into staging and check if the deploy went through, then check disk usage."

One SSH connection, multiple commands. The agent checks the deploy log, sees it succeeded, checks disk space, and summarizes everything — all without reconnecting.

<!-- IMAGE: Upload drafts/images/screenshot-ssh.png -->
*The agent SSHs into a server, checks deploy logs, checks disk — all in one persistent session.*

### 4. Rails/Django Console

"Open rails console and check if user X has the enterprise plan flag."

This is one of those things that takes 30 seconds if you already have a console open, but 2 minutes if you don't (open terminal, cd to project, bundle exec, wait for Rails to load, type query). Now it's one sentence — and the console stays open for follow-up questions.

### 5. Dev Servers + Testing

"Start the dev server in one session, run integration tests against it in another."

Both sessions stay alive. The agent can check the server logs in one session while running tests in another. Currently, the agent would have to background the server, hope it started in time, run tests, then try to kill the backgrounded process.

### 6. Docker Container Debugging

"Shell into the running web container and check the last 100 lines of the app log for errors."

The agent handles `docker exec -it`, reads the logs, and can stay in the container to investigate further based on what it finds.

---

## How It Works Under the Hood

Three things make this work well in practice:

### Clean Output via xterm-headless

Raw terminal output is full of ANSI escape codes — colors, cursor positioning, screen clearing. If you dump this to an AI, it wastes tokens and confuses the model.

Instead, I pipe PTY output through `@xterm/headless` — the same terminal emulator used in VS Code, but without a UI. It processes all escape sequences internally, then I read the terminal buffer as plain text. The AI sees exactly what a human would see on screen. Progress bars render correctly. `\r` overwrites work. Cursor positioning works. It's just clean text.

### Smart "Command Done" Detection

The hardest part of interacting with a terminal programmatically is knowing when a command is *done*. Waiting a fixed time is unreliable — some commands finish instantly, others take minutes.

I use a 4-layer detection strategy:

1. **Process exit** — if the process died, we're done
2. **Prompt detection** — auto-detect the session's prompt (`$`, `>>>`, `#`, etc.) at startup, watch for it to reappear
3. **Output settling** — no new output for 300ms means it's probably done
4. **Timeout** — always return after the configured timeout with `is_complete: false`

This handles everything from instant `echo` commands to long-running `bundle install` without the AI having to guess.

### Security

The security model is comparable to what you'd get with a regular Bash tool — but with extra options if you need them. There's an optional sandbox mode for tighter environments, configurable command allowlists/blocklists, and a two-step confirmation flow for dangerous commands (`rm -rf`, `DROP TABLE`, etc.) that forces the AI to use a separate tool with an explicit justification. Secret redaction can catch things like AWS keys or tokens in output. Turn on as much or as little as your setup needs.

---

## Installation

For **Claude Code** — one command:

```bash
claude mcp add terminal -- npx -y mcp-interactive-terminal
```

For **Cursor**, **Windsurf**, or **any MCP client**:

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

That's it. Zero config. Works on macOS, Linux, and Windows.

---

## Try It

Install it, ask your agent "open a Python REPL and calculate 2**100", and see it work.

The repo is open source under MIT:

- **GitHub:** https://github.com/amol21p/mcp-interactive-terminal
- **npm:** https://www.npmjs.com/package/mcp-interactive-terminal

If you have use cases I haven't thought of, or run into issues, open an issue or drop a comment below. I'd love to hear what interactive workflows you wish your AI agent could handle.

---

**Tags:** `Artificial Intelligence`, `Software Development`, `Developer Tools`, `Programming`, `Open Source`
