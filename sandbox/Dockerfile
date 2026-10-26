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

RUN mkdir -p /workspace \
  && chown -R 1000:1000 /workspace /home/node

USER 1000:1000
WORKDIR /workspace

CMD ["sleep", "infinity"]
