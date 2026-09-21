# Sandbox runtime

Workspace defaults and task overrides control CPU, memory, process count, workspace access, and networking. Each turn records the resolved settings so changes affect subsequent turns.

Read-only tasks first prepare their repository in a separate container with writable source and ephemeral home storage. The agent and project checks then mount the task's work volume read-only. Docker enforces that mount even if the agent attempts to change file permissions. Home and temporary storage remain writable.

## Provider-only networking

The task joins an internal Docker network whose bridge has no host address (`gateway_mode_ipv4=isolated`). It receives no direct Internet route, and external DNS forwarding is disabled. A separate, unprivileged proxy joins that network and Docker's outgoing bridge. It has no project mounts or credentials.

The proxy accepts TLS CONNECT on port 443 to exact provider hosts only:

- Codex: `api.openai.com`, `auth.openai.com`, `chatgpt.com`.
- Claude: `api.anthropic.com`, `platform.claude.com`, `claude.ai`, `claude.com`.

It rejects private and reserved IPv4 destinations, pins the resolved public address, and checks that the TLS ClientHello server name matches the CONNECT target. It does not decrypt TLS. Unknown hosts, plain HTTP, alternate ports, and direct connections are blocked. The same network policy applies during preparation and verification, so package installation may require Internet mode.

With a company gateway selected, the allowlist is replaced by that gateway's exact HTTPS hostname and port. Eligible private company addresses are allowed only for this explicit gateway; loopback, link-local and metadata addresses remain blocked. Direct provider hosts are not a fallback. The proxy still checks the TLS server name. This policy does not permit downloads, plugins, or external MCP servers. Claude's [network configuration](https://code.claude.com/docs/en/network-config) documents the direct authentication and API endpoints; Codex supports [ChatGPT and API-key authentication](https://learn.chatgpt.com/docs/auth).

Each turn owns `nerilo-net-<turnId>` and `nerilo-egress-<turnId>`. Both carry the managed/task labels. Completion, failure, and pause release the proxy and network; task deletion also removes labeled network resources.

## Native Claude verification

Native Claude sign-in stays in its dedicated Docker authentication volume. Preparation runs without that volume. After the agent exits successfully, a separate verification container receives only the task's work volume and ephemeral home storage. No native authentication volume or API-key environment variables are supplied.

The turn retains the verification container name, command, and pinned image. A daemon restart can resume observing an existing check without running it twice. Verification captures its own output and the final file diff after checks finish. Checks honor the recorded workspace mode and resource/network limits.

## Validation

- `bun scripts/smoke/sandbox-smoke.ts`: actual Docker read-only, CPU, memory, and process limits.
- `bun scripts/smoke/network-smoke.ts`: provider TLS succeeds; other proxy destinations, private addresses, direct Internet, and host access fail.
- `bun scripts/smoke/network-agent-smoke.ts`: a real Codex request succeeds through the restricted network.
- `NERILO_TEST_IMAGE=nerilo-beta:20260919 bun scripts/smoke/gateway-smoke.ts`: both real CLIs complete connection checks, first turns and resumed sessions through a local HTTPS gateway fixture with fake credentials, private CA trust, routing headers, credential-free verification and blocked public endpoints.
- `bun scripts/smoke/verification-smoke.ts`: credentials are absent, verification resumes from a fresh record, and check-generated changes are captured.
- `bun test containers/src/egress.test.mjs`: destination parsing and address restrictions.

Runtime scripts require an image built from the current Dockerfile. `NERILO_AGENT_IMAGE` can select a separate QA image without replacing the active environment.
