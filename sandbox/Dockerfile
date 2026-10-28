FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    ripgrep \
    build-essential \
    python3 \
    python3-venv \
    ffmpeg \
    jq \
    zip \
    unzip \
    curl \
  && rm -rf /var/lib/apt/lists/*

# OpenCode harness — version pinned; bump deliberately (docs/refactor-opencode.md).
RUN npm install -g opencode-ai@1.19.5 \
  && opencode --version

# All OpenCode state lives on the user volume (/workspace) so sessions and
# config survive container restarts; nothing is written to the read-only rootfs.
ENV XDG_DATA_HOME=/workspace/.kairo/data \
    XDG_STATE_HOME=/workspace/.kairo/state \
    XDG_CACHE_HOME=/workspace/.kairo/cache \
    XDG_CONFIG_HOME=/workspace/.kairo/config \
    OPENCODE_CONFIG=/workspace/.kairo/config/opencode.json \
    OPENCODE_DISABLE_AUTOUPDATE=1 \
    OPENCODE_DISABLE_PRUNE=1 \
    OPENCODE_DISABLE_LSP_DOWNLOAD=1 \
    OPENCODE_DISABLE_MODELS_FETCH=1 \
    OPENCODE_LOG_LEVEL=INFO

RUN mkdir -p /workspace \
  && chown -R 1000:1000 /workspace /home/node

USER 1000:1000
WORKDIR /workspace

# Headless server for the orchestrator (SDK) — basic auth via
# OPENCODE_SERVER_PASSWORD injected per container by DockerWorkspace.
EXPOSE 4096
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
