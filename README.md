# t3-agent

Headless CLI/client for [T3 Code](https://github.com/pingdotgg/t3code) environments.

`t3-agent` lets persistent agents (and humans) **list threads, read status, and start turns** on a running T3 server — using T3's existing auth and orchestration HTTP API — without the web or desktop UI.

This repo is a **thin client**. It does not fork T3 Code and does not embed a T3 server.

- **License:** MIT
- **Status:** HTTP MVP (no WebSocket watch yet)
- **Build plan:** [docs/PLAN.md](docs/PLAN.md)
- **T3 compatibility:** researched against `pingdotgg/t3code` `6ba15c027a6d411c7f75cc0ca59b601a295c3633`; rechecked on `b5f7fa0ede2a0d791226e6474c9cc4374dd89cc9` (2026-09-08). See [docs/CONTRACTS.md](docs/CONTRACTS.md).
- **Remote smoke:** [docs/SMOKE.md](docs/SMOKE.md)

## Install

Requires **Node.js 22+**.

```bash
git clone https://github.com/Milind220/t3-agent.git
cd t3-agent
pnpm install
pnpm build
pnpm exec t3-agent --help
```

Or install the package locally and use the `t3-agent` bin:

```bash
pnpm add t3-agent
pnpm exec t3-agent env
```

`npm install` / `npm test` / `npm run build` work as well (`package.json` scripts are the same).

## Auth and config

On the machine that runs T3 (never commit the output):

```bash
t3 auth session issue --json
# or: t3 auth session issue --token-only
```

Then, from any client that can reach that environment:

```bash
export T3_AGENT_URL="http://127.0.0.1:8080"
export T3_AGENT_TOKEN="<bearer>"
```

Flags override env: `--url`, `--token`, `--timeout`, `--ws-url` (WS is reserved for a later `watch` command).

Copy [`.env.example`](.env.example) to `.env` locally if you want a dotenv file — this CLI reads **process env / flags only** in the MVP (no implicit `.env` load, no Helsinki hostnames).

## Commands

Stdout is **JSON** (pretty-printed). `--json` is accepted and is the default.

```text
t3-agent env                          # environment + session
t3-agent threads [--project] [--status]
t3-agent thread get <id> [--turns N]
t3-agent thread create --project <id> --title "…" [--instance] [--model] --runtime-mode approval-required
t3-agent turn start --thread <id> --text "…" --runtime-mode approval-required
t3-agent turn interrupt --thread <id>
t3-agent status [--thread <id>]
```

| Command | T3 HTTP |
| --- | --- |
| `env` | `GET /.well-known/t3/environment` + `GET /api/auth/session` |
| `threads` | `GET /api/orchestration/shell` |
| `thread get` | `GET /api/orchestration/threads/:id` |
| `thread create` | `POST /api/orchestration/dispatch` `thread.create` |
| `turn start` | `POST /api/orchestration/dispatch` `thread.turn.start` |
| `turn interrupt` | `POST /api/orchestration/dispatch` `thread.turn.interrupt` |
| `status` | shell snapshot, compacted |

`thread create` / `turn start` **always send `runtimeMode`**. If you omit `--runtime-mode`, this CLI sends `approval-required` (T3's own default if a client omits the field is `full-access`).

`thread create` uses `--instance` + `--model` when given; otherwise it uses the project's `defaultModelSelection` from the shell snapshot.

Success envelope:

```json
{ "ok": true, "t3": { "serverVersion": "…", "environmentId": "…" }, "data": { } }
```

Errors go to stderr as `{ "ok": false, "error": { "code", "message", "traceId?" } }`.

| Exit | Meaning |
| --- | --- |
| 0 | ok |
| 1 | usage / missing config |
| 2 | auth / scope / DPoP-bound token |
| 3 | not found |
| 4 | transport / timeout |
| 5 | dispatch rejected / server error |

## Develop

```bash
pnpm test
pnpm build
pnpm exec t3-agent --help
```

HTTP client tests use a mock `fetch`. Live-server checks are documented in [docs/SMOKE.md](docs/SMOKE.md), not run in CI.

## Non-goals

- WebSocket subscribe / Effect RPC `watch`
- DPoP / T3 Connect login flows
- Terminal, git, PR, approvals, attachments
- Forking or vendoring all of `pingdotgg/t3code`
- Upstream `t3 agent` PR into T3
- Runtime permission policy (`full-access`, provider sandboxes) — enforced **by the T3 server**. This CLI only dispatches `runtimeMode` on commands T3 already defines.
- Publishing Helsinki (or any host) credentials or a default production URL

## Relationship to other repos

| Repo | Role |
| --- | --- |
| [Milind220/t3-agent](https://github.com/Milind220/t3-agent) | This project |
| [pingdotgg/t3code](https://github.com/pingdotgg/t3code) | Server contracts we consume; do not fork |
