# Agent connections

Open **Settings → Connections** on the execution machine you want to use. Codex and Claude Code each support an existing login, a fresh subscription sign-in, a direct API key, or a company gateway. Connecting one agent is enough to start a task; configure both to switch between them.

These controls currently work through Nerilo's local web server and its registered machines. A published website needs an explicit visitor-to-machine connection before it can access that visitor's local accounts or repositories. See the [beta readiness review](../reviews/beta-readiness-2026-09-19.md).

## Existing accounts

**Use existing login** appears when Nerilo finds usable credentials on the selected execution machine. Codex currently imports file-based credentials from `CODEX_HOME/auth.json`, normally `~/.codex/auth.json`. Claude Code reads its specific macOS Keychain account, with the CLI's credential-file fallback on other platforms. Empty or malformed credentials are not offered as a working login.

Importing creates a private Nerilo copy. It does not sign out the source tool, rewrite its settings, or copy its hooks and plugins. If an imported login stops working after the original tool refreshes or revokes it, use **Refresh existing login** or sign in again through Nerilo. Codex accounts stored only in the OS keyring can use Nerilo's ChatGPT sign-in instead.

For a fresh subscription connection, open the agent's connection menu and choose **Sign in to ChatGPT** or **Sign in to Claude Code**. Docker and the agent environment must be ready first. Codex shows an official device sign-in URL and a one-time code. Claude opens its official browser flow and asks for the returned authorization code. Complete these steps in the product; never paste credentials into task messages.

## Company gateways

Choose **Use a company gateway**. When Nerilo finds a compatible installed agent configuration, the dialog can import its connection settings. It reads Claude's `settings.json` or Codex's `config.toml` on the execution machine. Import does not execute the key helper until the connection is actually used.

For manual setup, enter the HTTPS gateway URL and the exact model ID or alias supplied by your company. Codex requires an OpenAI Responses-compatible route. Claude Code requires an Anthropic Messages-compatible route. Include any required base path, such as `/v1`, in the URL.

Choose one credential source:

- **API key** stores a private copy for this connection.
- **Environment variable** reads the named variable from the daemon environment. Restart the daemon after changing its environment.
- **Key manager command** runs a saved command on the execution machine for each request. It must print only the current key on one line. The command can call an existing company key manager; it is not run inside the task container. A missing key or failed helper produces an error.

Advanced settings cover `Authorization: Bearer` versus `x-api-key`, required custom headers, Claude model mappings, and a company CA certificate in PEM format. For example, a gateway may require `x-portkey-provider: @company-provider` and an `ANTHROPIC_DEFAULT_OPUS_MODEL` alias. Use the actual values supplied by your company. The gateway itself does not have to be Portkey.

Nerilo imports supported model aliases and selected Claude flags. It does not import shell settings, hooks, plugins, arbitrary environment variables, or permission overrides. Saved secret values are never returned to the settings page. Leaving a secret blank while editing retains it; changing the gateway host requires re-entering the credential and any saved headers.

Click **Test connection** before starting important work. A saved configuration means it is configured; the test confirms that the current account, model and route can answer. A corporate VPN, private DNS and company CA may all be necessary on the execution machine.

## Where credentials go

Direct API keys use macOS Keychain. Imported Codex credentials and gateway configuration use owner-only local files; Claude subscription credentials use a dedicated Docker volume. The agent receives the resolved gateway key and headers for its request. Key helper commands stay on the host. Task output redacts supplied secrets, and project verification runs without gateway credentials.

Selecting a gateway disables direct-provider credential fallback. In **Provider-only** networking, the only allowed destination is that gateway's exact HTTPS host and port. Private company addresses are permitted only for this explicit gateway; loopback and metadata addresses remain blocked. Normal **Internet** networking still permits task tools to use the Internet. See [sandbox networking](../architecture/sandbox-runtime.md).

Changing the connection starts the next turn with fresh agent context while preserving the task's workspace and prior conversation. Disconnect removes Nerilo's connection without logging out the original installed agent.

Provider references: [Codex authentication](https://learn.chatgpt.com/docs/auth), [Codex custom providers](https://learn.chatgpt.com/docs/config-file/config-advanced#custom-model-providers), and [Claude Code gateways](https://code.claude.com/docs/en/llm-gateway).

## OpenCode and Pi

After updating Nerilo, rebuild the agent image (`bun run image:build`). Both harnesses are installed at pinned versions in that image; no host CLI installation is required to run tasks.

In **Settings → Connections**, connect OpenCode or Pi with an API key and select its model provider: Anthropic, OpenAI, Google, or OpenRouter. On macOS the key is saved in Keychain. On other platforms, supply `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY` to the daemon. Multiple environment keys can be available at once. Saving a key selects that key instead of environment credentials.

**Import existing API keys** copies supported literal API keys from OpenCode's `${XDG_DATA_HOME:-~/.local/share}/opencode/auth.json` or Pi's `${PI_CODING_AGENT_DIR:-~/.pi/agent}/auth.json` into private Nerilo storage. This does not change the original files. OAuth/subscription logins, shell key helpers, and Pi environment references are not imported. Disconnect removes Nerilo's copy and disables environment fallback for that harness.

Choose the harness from the model picker or an agent preset. The default selects an available provider and a starter model; custom models use `provider/model`, such as `openai/gpt-5.4` or `openrouter/anthropic/claude-sonnet-4.6`. API access depends on your account. Pi maps Nerilo's “None” effort to its “off” thinking level; OpenCode forwards effort as a model variant. Variants and thinking support depend on the selected model.

Both integrations preserve native sessions between turns, surface tool activity and errors, support selected skills, and run inside the same Docker workspace and resource limits as the other agents. OpenCode supports Nerilo's local and remote MCP configuration. Pi has no built-in MCP support: deselect MCP servers in the task's tools before running it. Company gateways and interactive subscription login are currently available only for Codex and Claude Code. Under provider-only networking, the new harnesses can reach the four supported API hosts; package downloads and arbitrary websites remain blocked.

The `bun run test:harnesses` smoke test runs both pinned CLIs with networking disabled against an in-container fixture API, checks a real shell tool call, and verifies session resumption. It does not make paid model calls. Set `NERILO_SMOKE_IMAGE` to test another image tag.

CLI references: [OpenCode](https://opencode.ai/docs/cli/) and [Pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).
