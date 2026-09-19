# MCP servers

Settings → MCP servers manages tools available to Nerilo agents. Add a server, choose its transport, and enable it. Enabled servers apply to both Codex and Claude by default on the next turn, including follow-ups. The Tools menu beside the model picker selects a subset for a particular task. Use defaults inherits the enabled list; None excludes all skills and MCP servers. Globally disabled servers are never passed to tasks. Changing the list does not interrupt a running turn. Disabled servers are not passed to the runner. Metadata, titles and summary generation do not receive these tools.

## Command servers

A command server runs inside the task container, with `/work/repo` as its working directory. Provide an executable, an array of arguments, and optional environment variables. For example, use `npx` with arguments `["-y", "your-mcp-package"]`, or `node` with a repository-relative script path. Packages and executables must be available inside the container. A path on the Mac is not automatically mounted into a task.

Commands inherit the task's resource and network restrictions. Downloading a package or contacting an external API requires the relevant network access. Command arguments are passed as an argument array, not joined into a shell command.

## HTTP servers

Provide a Streamable HTTP MCP endpoint and optional HTTP headers. An authorization header can supply a server token. Interactive OAuth sign-in and legacy SSE endpoints are not provided by this settings editor.

For a server running on the Mac, use `http://host.docker.internal:PORT/mcp`. `localhost` inside the agent container refers to that container. The server must be reachable from Docker Desktop.

Selected HTTP servers require a task sandbox with Internet access. Unselected servers do not affect this check. Nerilo reports a configuration error before starting a restricted task rather than expanding its network permissions. The queued request remains available for retry after changing the sandbox or disabling the HTTP server.

## Storage and isolation

Server configuration is stored locally in Nerilo's data directory. Environment variables and headers can contain credentials; the settings editor can read and change them, while the server list only shows descriptive details. Nothing is imported from the host's existing MCP configuration automatically.

The runner receives the enabled configuration for its turn. Credentials are written to private provider configuration inside that container, kept out of provider command-line arguments and removed before verification. Configured secret values are redacted from captured agent output. Removing or disabling a server prevents it being supplied on subsequent turns.

The supported transports follow the [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports). Provider compatibility is verified against the CLI versions pinned in `containers/Dockerfile`.
