I built an open-source tool that lets AI agents actually use interactive terminals

If you use Claude Code, Cursor, or any AI coding agent — you've noticed they can run bash commands, but that's it. They fire off a command, get the output, and the process is gone. No way to go back to it.

This creates annoying workarounds:

Want to test something in a Python REPL? The agent can't keep one open. So it writes a throwaway script, runs it, reads the output, deletes it. For every small thing.

Need to check your database? The agent can't hold a psql session open. Every query is a fresh connection via psql -c. Want to explore a schema then query based on what you see? That's 5 separate connect-disconnect cycles.

Working with a dev server? The agent starts it, but then can't interact with it again. Next command? Start the server again. Need to check logs while it's running? Can't — the process is gone.

The root issue: no persistent sessions. Every command is fire-and-forget.

So I built mcp-interactive-terminal — an MCP server that gives AI agents real, persistent terminal sessions. Open a session (bash, python3, psql, ssh, node), send commands, wait for output, send more — the session stays alive between interactions.

Real use cases:

- "Open python and test this regex against 5 edge cases" — one session, iterates through all, reports back. No throwaway scripts.
- "Connect to staging postgres, show largest tables, then count this week's signups" — one psql session, multiple queries, no reconnecting.
- "SSH into staging and check if the deploy went through" — connects once, runs multiple commands, reports status.
- "Start the dev server in one session, run tests against it in another" — both stay alive.

Under the hood: xterm-headless (same terminal emulator as VS Code) for clean output, smart completion detection, and optional security controls — sandbox mode, command allowlists, and two-step confirmation for dangerous commands like rm -rf or DROP TABLE.

One command to install: npx -y mcp-interactive-terminal

Works with Claude Code, Cursor, Windsurf, VS Code Copilot, and any MCP client.

Open source (MIT): https://github.com/amol21p/mcp-interactive-terminal

What interactive workflows do you wish your AI agent could handle?

#OpenSource #AI #DeveloperTools #MCP #ClaudeCode #Cursor #CodingAgents
