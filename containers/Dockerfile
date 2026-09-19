FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
ARG CODEX_VERSION=0.153.4
ARG CLAUDE_VERSION=2.1.259
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ curl unzip ripgrep \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g @openai/codex@${CODEX_VERSION} @anthropic-ai/claude-code@${CLAUDE_VERSION} bun@1.4.2
RUN mkdir -p /work /etc/codex && chown node:node /work \
    && ln -s /tmp/nerilo-codex-mcp.toml /etc/codex/config.toml \
    && ln -s /tmp/nerilo-skills/skills /etc/codex/skills
COPY runner.mjs process.mjs agent.mjs git.mjs /opt/nerilo/
COPY mcp.mjs /opt/nerilo/mcp.mjs
COPY connection.mjs /opt/nerilo/connection.mjs
COPY skills.mjs /opt/nerilo/skills.mjs
COPY metadata.mjs /opt/nerilo/metadata.mjs
COPY bootstrap.mjs /opt/nerilo/bootstrap.mjs
COPY egress.mjs /opt/nerilo/egress.mjs
COPY verify.mjs /opt/nerilo/verify.mjs
ENV HOME=/home/node CODEX_HOME=/home/node/.codex
USER node
WORKDIR /work
ENTRYPOINT ["node", "/opt/nerilo/runner.mjs"]
