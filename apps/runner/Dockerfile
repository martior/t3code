# One member's T3 Code server. Build from this folder:
#   docker build -t t3-runner:latest apps/runner
# Pin a release with --build-arg T3CODE_VERSION=0.1.10.
FROM node:26-bookworm-slim

ARG T3CODE_VERSION=
ARG T3CODE_CHANNEL=stable

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq less openssh-client procps python3 ripgrep unzip \
  && rm -rf /var/lib/apt/lists/*

# The base image's uid 1000 becomes `t3`; t3-runner starts containers as 1000:1000.
RUN groupmod --new-name t3 node \
  && usermod --login t3 --home /home/t3 --move-home node

# The release lives outside the member volume so `t3-runner upgrade` replaces it.
RUN curl -fsSL https://t3.codes/install.sh -o /tmp/install.sh \
  && T3CODE_HOME=/opt/t3 T3CODE_INSTALL_BIN_DIR=/usr/local/bin \
    T3CODE_VERSION="$T3CODE_VERSION" T3CODE_CHANNEL="$T3CODE_CHANNEL" sh /tmp/install.sh \
  && rm /tmp/install.sh \
  && t3 --version

# /home/t3 is the member volume: T3 home, projects, worktrees, and agent CLIs installed
# with `npm install -g` all persist there. Loopback only; T3 Connect's tunnel reaches it.
ENV HOME=/home/t3 \
  T3CODE_HOME=/home/t3/.t3 \
  T3CODE_HOST=127.0.0.1 \
  T3CODE_PORT=3773 \
  NPM_CONFIG_PREFIX=/home/t3/.local \
  PATH=/home/t3/.local/bin:$PATH

USER t3
WORKDIR /home/t3
CMD ["t3", "serve"]
