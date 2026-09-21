# Multiple machines

Each registered machine runs its own Nerilo daemon and Docker engine. Tasks run on the machine selected when they are created. Their workspace, queued messages, follow-ups, agent sessions, and credentials stay on that machine. Keep the daemon running for scheduled work and autonomous pull request handling.

An existing task continues on its original machine. Registering another machine does not move tasks or copy provider credentials. Sign into Codex or Claude on each execution machine, or configure that machine's connection in Nerilo.

## Prepare a machine

Install Bun, Docker, and the Nerilo checkout on the other computer. Start Docker, install the workspace dependencies with `bun install`, and build the agent image with `bun run image:build`.

Start the daemon from the checkout:

```sh
NERILO_MACHINE_NAME="Build Mac" bun run daemon
```

The daemon listens on `127.0.0.1:5186`. `NERILO_DAEMON_PORT` changes the port; `NERILO_DATA_DIR` changes its data directory. Use the same data directory when starting the daemon and exporting its connection. The persistent `machine-id` identifies this installation, even after a rename or restart. Give independent installations their own data directories rather than copying an existing installation's machine identity.

## Connect through SSH

On the computer running the Nerilo web app, open a tunnel to the other machine:

```sh
ssh -N -L 127.0.0.1:5187:127.0.0.1:5186 user@build-machine
```

Keep that SSH session open while using the machine. Give each machine a different local forwarding port. The daemon remains reachable only on its own loopback interface, with SSH providing the remote connection.

On the execution machine, export a connection file from the Nerilo checkout:

```sh
bun scripts/machine-connection.ts \
  --url http://127.0.0.1:5187 \
  --output "$HOME/nerilo-build-machine.json"
```

`--url` is the address reachable from the computer running Nerilo's web server. In this example that is the local end of the SSH tunnel, not the execution machine's public address.

Transfer the file privately to the computer running Nerilo, then import it in **Settings → Machines**. The file contains a daemon access token, so treat it as a credential. The export command creates it with owner-only permissions, never prints the token, and refuses to overwrite an existing file. After importing, delete the transferred copies when they are no longer needed.

## Connect through HTTPS

An existing HTTPS reverse proxy can forward a dedicated origin to the daemon's loopback port. Preserve the Authorization header and allow streaming responses for `/events`. Use a trusted TLS certificate and keep the upstream daemon on loopback.

Export the connection with the HTTPS origin:

```sh
bun scripts/machine-connection.ts \
  --url https://nerilo-build.example.com \
  --output "$HOME/nerilo-build-machine.json"
```

Connection URLs use HTTPS, or HTTP on localhost for tunnels. Plain HTTP to other machines is rejected. A URL must be an origin without a path, embedded credentials, query, or fragment.

## Choose where work runs

Select a machine before starting a task. Projects, provider connections, models, tools, and sandbox settings belong to the selected machine. A local project path refers to that machine's filesystem. To work on a repository without an existing checkout there, add the repository by its GitHub URL on that machine.

If a machine disconnects, its work cannot be started on a different machine by accident. Restore its connection to continue using its tasks. Removing a machine from Nerilo disconnects its registration; it does not delete the remote daemon's tasks or workspaces.

## Identity and access

### GitHub accounts

Open **Settings → Connections → GitHub** to see the GitHub CLI accounts saved on the selected machine. Choose **Use account** to switch that host’s active account with `gh auth switch`. The change also applies to GitHub CLI commands outside Nerilo on that machine. It does not change Git commit authors or SSH keys.

To add an account, run `gh auth login` in a terminal on that machine, complete sign-in, and choose **Refresh accounts**. Accounts with authentication errors must be signed in again before switching. If authentication comes from `GH_TOKEN`, `GITHUB_TOKEN`, or an enterprise token environment variable, remove that variable from the daemon’s environment and restart Nerilo to use saved accounts instead.

### Project and task GitHub accounts

Set **Default GitHub account** when adding or editing a project. Tasks use that account unless overridden. **Use machine default** keeps the project on the GitHub CLI’s active account.

Choose a task override from the GitHub picker before starting a task, including when choosing **Work on PR**. For an existing task, open its actions menu and choose **GitHub account**. **Use project default** clears the override. A running turn must finish before its task override can change.

The order is **task override → project default → machine default**. Changing a project default affects subsequent GitHub operations for tasks that inherit it; an operation already in progress keeps its selected account. Overrides currently apply to github.com, matching Nerilo’s supported repository and PR URLs.

Nerilo resolves the named login using `gh auth token --hostname github.com --user LOGIN` and passes its token only to the individual GitHub CLI or HTTPS Git command. Parallel tasks can use different accounts without changing `gh auth switch` or the daemon’s environment. Only the account name and host are stored with the project/task; credentials remain managed by GitHub CLI. Missing saved credentials stop the operation rather than falling back to another account. These choices cover repository access, PR actions, and Autopilot; they do not change Git commit authors, SSH keys, or give the sandboxed agent credentials.

### Daemon access

`GET /machine` uses the same bearer authentication as every other daemon endpoint. Its response contains only the stable UUID, machine name, operating-system platform, and protocol version. Connection import verifies the expected identity so a reused tunnel port cannot silently send work to a different daemon.

The access token grants control of the daemon, including tasks and its connected agent accounts. Tokens are kept on the Nerilo server and are never included in browser snapshots. Use trusted machines and private transfers. To replace a compromised token, stop that daemon, replace its `daemon-token` file with a fresh random value using owner-only permissions, restart it, and reconnect using a fresh export. Leave `machine-id` intact so the daemon retains its identity.
