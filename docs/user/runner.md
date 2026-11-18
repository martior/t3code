# Run T3 Code for a team

`t3-runner` gives each member of a team their own T3 Code server on a shared Linux host. Each
server is an ordinary single-user T3 Code server running in its own Docker container, linked to
the member's own T3 account through T3 Connect. Members open it from the desktop, web, or mobile
apps like any other machine; nothing on the host is shared with other members.

## Requirements

- A Linux host with Docker, and an administrator account that can run `docker`.
- Node.js 26 and a checkout of T3 Code with dependencies installed (`vp i`). Run the tool as
  `node apps/runner/src/bin.ts`; the examples below call it `t3-runner`.
- Each member needs a T3 account, since their server links to T3 Connect.

## Set up the host

1. Build the server image. It installs the newest stable `t3` release; add
   `--build-arg T3CODE_VERSION=<version>` to pin one.

   ```sh
   docker build -t t3-runner:latest apps/runner
   ```

2. Write a config and edit it:

   ```sh
   t3-runner init
   ```

   ```json
   {
     "image": "t3-runner:latest",
     "memory": "8g",
     "cpus": 2,
     "pidsLimit": 4096,
     "sharedMounts": [{ "source": "/srv/git-mirror", "target": "/mnt/git-mirror" }],
     "policyFile": "/etc/t3-runner/policy.json",
     "env": { "GIT_MIRROR": "/mnt/git-mirror" }
   }
   ```

   | Field          | What it does                                                                                       |
   | -------------- | -------------------------------------------------------------------------------------------------- |
   | `image`        | The image every member's server runs.                                                              |
   | `memory`       | Memory cap per member, such as `8g`. Swap is capped to the same amount.                            |
   | `cpus`         | CPU share per member, such as `2` or `1.5`.                                                        |
   | `pidsLimit`    | Most processes a member's server and agents can run at once.                                       |
   | `sharedMounts` | Host folders mounted read-only into every server, such as a git mirror or a package store.         |
   | `policyFile`   | Optional [managed policy](./managed-policy.md) mounted read-only for every server.                 |
   | `env`          | Environment variables for every server. `HOME` and the `T3CODE_HOME/HOST/PORT` variables are kept. |

   Commands read `runner.json` in the current folder; pass `--config <path>` for another.

## Add and manage members

| Task                              | Command                             |
| --------------------------------- | ----------------------------------- |
| Add a member                      | `t3-runner member add <name>`       |
| See members and their servers     | `t3-runner member list`             |
| Stop or start a member's server   | `t3-runner member stop <name>`      |
|                                   | `t3-runner member start <name>`     |
| Link a server to T3 Connect again | `t3-runner member link <name>`      |
| Remove a server, keeping its data | `t3-runner member rm <name>`        |
| Remove a server and its data      | `t3-runner member rm <name> --wipe` |
| Move every server to a new image  | `t3-runner upgrade`                 |

Names use lowercase letters, digits, and dashes, starting with a letter.

`member add` starts the server and prints a sign-in link and code. Send them to the member, who
approves with their own T3 account; the server then appears in their T3 Code apps. If the code
expires first, run `member link`.

Each member keeps their home folder, projects, worktrees, T3 Code data, and agent sign-ins in a
Docker volume. Removing a member without `--wipe` keeps that volume, and `member add` with the same
name brings the server back with everything in place. Members install and sign in to their agents
(Claude Code, Codex, and others) from their server's terminal, and those installs persist too.

To update, build or pull the new image, then run `t3-runner upgrade`. It recreates each server
from the image and keeps every member's data. Running agent turns stop.

## Security model

- The container is the boundary between members. Each server runs as a non-root user without
  extra privileges, with its own volume. Shared folders and the policy are mounted read-only, so
  nothing writable is shared between members.
- Only `t3-runner` uses the Docker socket. It is never mounted into a member's container.
- Each server listens only on loopback inside its container. Members reach it through their own
  T3 Connect link, not through a port on the host.
- Each member's container has its own Docker network. It can reach the internet, but not other
  members' containers or the services their agents start.
