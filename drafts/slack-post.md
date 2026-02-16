Hey folks! I built and open-sourced something that might be useful if you're using Claude Code, Cursor, or any AI coding agent.

The problem: these agents can run bash commands, but every command is fire-and-forget. The process runs, gives output, and it's gone. There's no way to go back to it. So the agent ends up writing throwaway scripts and log files for every small thing, spinning up a fresh database connection for every query, and restarting dev servers because it lost the process handle.

I built mcp-interactive-terminal — an MCP server that gives AI agents real, persistent terminal sessions. The agent can open a session (python3, psql, ssh, node, bash, whatever), send commands, wait for output, send more commands — and the session stays alive between interactions.

Some examples of what this looks like:
• "Open a python REPL and test this regex against these edge cases" — one session, iterates through all of them, no temp scripts
• "Connect to staging postgres, show me the users schema, then count signups this week" — one psql session, multiple queries, no reconnecting each time
• "SSH into staging and check if the deploy went through" — connects once, runs multiple commands
• "Start the dev server in one session, run integration tests against it in another" — both sessions stay alive
• "Open rails console and check if user X has the enterprise flag" — one sentence vs open terminal, cd, bundle exec, wait for Rails, type query

Under the hood it uses xterm-headless (same terminal emulator as VS Code) so the AI sees clean text, not garbled escape codes. Smart completion detection knows when output is finished. And there's optional sandbox mode and security controls if you need them.

One command to install:
claude mcp add terminal -- npx -y mcp-interactive-terminal

Works with Claude Code, Cursor, Windsurf, VS Code Copilot, and any MCP client.

GitHub: https://github.com/amol21p/mcp-interactive-terminal
npm: https://www.npmjs.com/package/mcp-interactive-terminal

Open source (MIT) — would love any feedback or ideas!
