# T3 contract pin

`t3-agent` vendors a **minimal subset** of T3 Code HTTP types (command payloads, error codes, paths). It does **not** depend on the private `@t3tools/contracts` npm package.

## Pin

| Field | Value |
| --- | --- |
| Researched SHA (plan) | `6ba15c027a6d411c7f75cc0ca59b601a295c3633` |
| Rechecked against `pingdotgg/t3code` main | `b5f7fa0ede2a0d791226e6474c9cc4374dd89cc9` (2026-09-08) |
| Source of truth | `packages/contracts/src/{environmentHttp,orchestration,auth,environment}.ts` |

Bump this file when T3 changes an MVP path or command shape.

## HTTP surface used by the MVP

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/.well-known/t3/environment` | none |
| GET | `/api/auth/session` | Bearer |
| GET | `/api/orchestration/shell` | Bearer, `orchestration:read` |
| GET | `/api/orchestration/threads/:threadId` | Bearer, `orchestration:read` |
| POST | `/api/orchestration/dispatch` | Bearer, `orchestration:operate` |

Dispatch types sent: `thread.create`, `thread.turn.start`, `thread.turn.interrupt`.

`runtimeMode` is **always** encoded (`approval-required` by default in this CLI). T3's server default remains `full-access` if a client omits the field.

## Drift vs `docs/PLAN.md` (2026-09-08)

No MVP HTTP path or command-shape drift versus the plan pin. Recheck of latest `t3code` main showed the same:

- `EnvironmentHttpApi` routes for descriptor / session / shell / thread / dispatch
- `ThreadCreateCommand` / `ClientThreadTurnStartCommand` fields (including required `runtimeMode` on the client encode side)
- Tagged HTTP errors: `invalid_request`, `auth_invalid` (+ optional `dpopFailureReason`), `insufficient_scope`, `not_found` (`thread_not_found`), `internal_error`

Deferred (unchanged): WebSocket Effect RPC, DPoP, terminal/git/PR/approvals.

Mintlify `/api/websocket-protocol` and `/api/orchestration` remain stale (`orchestration.getSnapshot` is gone). Do not implement those.
