# t3-agent

Headless CLI/client for [T3 Code](https://github.com/pingdotgg/t3code) environments.

`t3-agent` lets persistent agents (and humans) **list threads, read status, start turns, and watch updates** on a running T3 server — using T3's existing auth and orchestration HTTP/WebSocket API — without the web or desktop UI.

This repo is a **thin client**. It does not fork T3 Code and does not embed a T3 server.

- **License:** MIT
- **Status:** planning. The CLI is not implemented yet.
- **Build plan:** [docs/PLAN.md](docs/PLAN.md) (MVP commands, real T3 method names, auth/WS flow, risks, phases)

## What it will do

```text
t3-agent env                 # environment + session (JSON)
t3-agent threads             # list threads from the shell snapshot
t3-agent thread get <id>     # read one thread
t3-agent turn start …        # dispatch thread.turn.start
t3-agent watch [--thread]    # subscribe to live shell/thread events
```

Stdout is structured JSON first; human-readable output is optional.

## Auth (no secrets in this repo)

On the machine that runs T3:

```bash
t3 auth session issue --json
```

Point the client at that environment with `T3_AGENT_URL` and `T3_AGENT_TOKEN`. See [docs/PLAN.md](docs/PLAN.md#5-auth-and-config).

## Relationship to other repos

| Repo | Role |
| --- | --- |
| [Milind220/t3-agent](https://github.com/Milind220/t3-agent) | This project (GitHub is the ship target) |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code) | Server contracts we consume; do not fork |
| Cursor Origin `milinds/t3-agent` | Mirror only |

Cursor cloud agents remain the path for product PRs. A T3 Helsinki box is just one place a `t3` server can run.

## Non-goals

Runtime permissions (`full-access`, provider sandboxes, “skip permissions”) are enforced **by the T3 server**, not by this CLI. We only dispatch `runtimeMode` on commands T3 already defines.
