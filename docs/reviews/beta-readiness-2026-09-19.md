# Beta readiness: 19 September 2026

The target is a published Next.js website used by technical and nontechnical Mac users. Execution must support Codex and Claude Code equally, through subscriptions, direct keys, or an internal company gateway. Nerilo must also be usable to develop itself.

## Completed in this pass

- Existing-login import remains a first-class connection choice for both agents. Empty Claude Keychain records and malformed Codex login files no longer appear usable. A browser-based Codex device sign-in joins the existing Claude sign-in flow.
- Gateway settings support private HTTPS endpoints, model IDs and aliases, custom headers, host environment variables, key-manager commands, and company CA certificates. Imported configuration excludes hooks, plugins and unrelated environment settings. Secret values stay out of settings responses and process arguments.
- Gateway selection removes direct-provider fallback. Provider-only networking permits the configured company endpoint, including eligible private addresses, and blocks public-provider destinations. A connection change starts fresh provider context for subsequent turns.
- Setup identifies Docker, agent installation, connection and project requirements. A task cannot start with an unconnected selected agent. A saved connection can be tested with an actual model request.
- Repository selection has a keyboard-accessible folder browser for the selected execution machine, committed-repository validation, canonical symlink handling, and recoverable filesystem errors. Manual paths remain available.
- Non-JSON server errors now give a recovery message and retain the original request identity for safe retries. The Next.js error boundary provides recovery controls.

## Evidence

- The combined macOS suite passed **221 tests, 1,388 assertions, 0 failures** across 59 files. Type checks, formatting, theme validation, and the Next.js production build passed.
- A real Codex connection check succeeded using the existing local subscription login.
- Nerilo created its own repository-picker change in an isolated task, ran verification, resumed the same Codex session for a review follow-up, and passed verification again. The exported patch was reviewed and incorporated into the host source. The host checkout and staging area were not used by the running agent.
- Both actual bundled CLIs, **Codex 0.155.1 and Claude Code 2.1.278**, passed the local HTTPS gateway fixture: CA trust, model routing, authentication headers, a structured connection response, a real first turn, session resumption, credential-free verification, and blocked public-provider access. This used fake credentials and the separate `nerilo-beta:20260919` image.
- Production UI checks covered light and dark themes at desktop and 390-pixel widths. Folder selection validates the repository and preserves the project draft when cancelled. The gateway form scrolls on narrow screens with its save controls accessible. No browser warnings or errors appeared during these checks.

The real company gateway has not been tested: its endpoint, VPN, model permissions, certificate and key manager need an on-network acceptance run. The Claude login currently saved on this Mac contains no usable tokens, so this pass did not complete a live Claude subscription task. Earlier Claude subscription evidence is recorded separately in the [lifecycle demonstration](lifecycle-demo.md).

## Published-site blocker

The existing web transport assumes that its Next.js server can reach the execution daemon and read a server-local connection token. Its machine registry is one server-local file. This is suitable for the current local preview; it does not establish separate visitor identities or reach a visitor's Mac from a published website.

Before publishing, settle execution ownership and implement the matching authenticated connection:

- A Mac companion needs explicit per-user pairing and a browser-local connection or an outbound authenticated relay. Local accounts and repositories remain on that execution machine.
- Hosted workers need user authentication, isolated machine and credential ownership, and a supported worker lifecycle.
- Supporting both requires clear machine selection without an implicit shared local default.

A website folder chooser returns a browser-scoped directory handle, not an unrestricted local filesystem path. A native macOS picker must be invoked through a paired local companion. The current folder browser lists repositories on the selected execution machine. See the [browser directory-picker API](https://developer.mozilla.org/en-US/docs/Web/API/Window/showDirectoryPicker).

The published website is not ready to release until this boundary is implemented and tested. A successful local demonstration is evidence for the execution and UI paths above, not for multi-user hosted access.
