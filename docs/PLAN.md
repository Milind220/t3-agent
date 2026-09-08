# t3-agent build plan

Concrete implementation plan for a thin, open-source headless CLI/client against a **running T3 Code environment**. This repo does **not** fork [pingdotgg/t3code](https://github.com/pingdotgg/t3code). It consumes T3's public HTTP + WebSocket contracts.

Researched against public T3 Code source at commit `6ba15c027a6d411c7f75cc0ca59b601a295c3633` (2026-09) plus `docs/internals/environment-auth.md` and `docs/internals/connection-runtime.md`. Mintlify pages (`/api/websocket-protocol`, `/api/orchestration`) are **stale** and must not be treated as the wire contract.

Status: Phase 1 HTTP MVP is implemented in this repo (see README). This plan remains the design note for watch / later phases.

---

## 1. Product intent

Persistent assistants (memory + ability to spawn Cursor cloud agents) need to **join, watch, and drive T3 threads** without the web/desktop UI:

- list / read threads and turn status
- start turns
- observe live shell/thread updates

T3 Helsinki (or any headless `t3` server) is an **agent runtime environment**. Cursor cloud agents remain the ship path for product PRs. `t3-agent` is the glue that talks to T3's existing auth + orchestration surface.

Primary I/O: **structured JSON on stdout**. Human-readable flags are secondary.

---

## 2. What T3 actually exposes (current, not Mintlify)

### 2.1 Two transports

T3's own `t3 project` CLI already talks to a live server over **HTTP**, not WebSocket. Official web/mobile clients use **both**: HTTP for snapshots/dispatch, Effect RPC over WebSocket for live subscribe + the rest of the desktop surface.

| Transport | Role for t3-agent |
| --- | --- |
| HTTP (`EnvironmentHttpApi`) | Auth, environment descriptor, shell/thread snapshots, command dispatch. **MVP default.** |
| WebSocket `/ws` (Effect `RpcClient` + `RpcSerialization.layerJson`) | Live `subscribeShell` / `subscribeThread`, optional WS `dispatchCommand`. **MVP watch path.** |

Do **not** implement the old Mintlify JSON-RPC shape `{ "id", "body": { "_tag": "orchestration.getSnapshot" } }`. That method is gone from `ORCHESTRATION_WS_METHODS`. Snapshots moved to HTTP; live updates are subscribe streams with `afterSequence` resume.

### 2.2 Auth (Helsinki / headless path)

Tokens are issued **on the T3 host**, not by this CLI:

```bash
# On the machine running T3 (or via SSH). Never commit the output.
t3 auth session issue --json
# optional: --ttl 7d --label "t3-agent" --subject "t3-agent"
```

JSON shape (`apps/server/src/cliAuthFormat.ts`):

```json
{
  "sessionId": "<AuthSessionId>",
  "token": "<bearer>",
  "method": "bearer-access-token",
  "scopes": ["orchestration:read", "orchestration:operate", "..."],
  "subject": "cli-issued-session",
  "client": { "deviceType": "bot" },
  "expiresAt": "2026-10-08T00:00:00.000Z"
}
```

`t3 auth session issue` grants `AuthAdministrativeScopes` (read + operate + terminal + review + access + relay). Default session TTL is **30 days**. Pairing tokens (`t3 auth pairing create`) grant only `AuthStandardClientScopes` and are a one-time bootstrap, not the steady-state credential.

Then, from any client that can reach the environment:

```
1. GET  /.well-known/t3/environment          → ExecutionEnvironmentDescriptor
2. GET  /api/auth/session                    → AuthSessionState (Bearer)
3. POST /api/auth/websocket-ticket           → { ticket, expiresAt }   (Bearer)
4. WS   {wsBase}/ws?wsTicket={ticket}        → Effect RPC session
```

Ticket response (`AuthWebSocketTicketResult`): `{ ticket, expiresAt }`. Default ticket TTL is **5 minutes** (`DEFAULT_WEBSOCKET_TOKEN_TTL`). The ticket is only for the upgrade URL so the long-lived bearer stays out of logs. After the socket is up, RPC scopes still apply per method.

Optional upgrade query params (ignored by older servers): `clientSurface`, `clientAppVersion`, `clientDeviceType`, `clientOs`, `connectionMethod`. Send `clientSurface=bot` (or omit) and `clientAppVersion=<t3-agent version>`.

**DPoP** (`Authorization: DPoP` + `dpop` header, `/oauth/token` exchange) is for T3 Connect / managed relay. Helsinki headless uses **bearer**. Do not implement DPoP in MVP. If a token is proof-bound, bearer-only calls fail with `auth_invalid` / `dpopFailureReason` — surface that clearly.

**Scopes that matter:**

| Scope | Needed for |
| --- | --- |
| `orchestration:read` | snapshots, subscribe, search, diffs, `server.probe` / `server.getConfig` |
| `orchestration:operate` | `dispatchCommand` / HTTP `POST /api/orchestration/dispatch` |
| `terminal:operate` | terminal RPCs — **deferred** |
| `access:read` / `access:write` | session listing / revoke — **deferred** |
| `relay:read` / `relay:write` | T3 Connect — **deferred** |

Every WS RPC has a required scope in `apps/server/src/auth/RpcAuthorization.ts`. Missing scope → `EnvironmentAuthorizationError` / HTTP 403 `insufficient_scope`.

### 2.3 HTTP orchestration

From `packages/contracts/src/environmentHttp.ts`:

| Method | Path | Scope | MVP? |
| --- | --- | --- | --- |
| GET | `/.well-known/t3/environment` | none | **yes** — version + capabilities |
| GET | `/api/auth/session` | authenticated | **yes** — `whoami` |
| POST | `/api/auth/websocket-ticket` | authenticated | **yes** — before any WS |
| GET | `/api/orchestration/shell` | `orchestration:read` | **yes** — list projects/threads |
| GET | `/api/orchestration/threads/:threadId` | `orchestration:read` | **yes** — read thread (+ optional `turnLimit`, `beforeCursor`) |
| POST | `/api/orchestration/dispatch` | `orchestration:operate` | **yes** — start turns / create thread |
| GET | `/api/orchestration/snapshot` | `orchestration:read` | **no** — full bodies; prefer shell + per-thread |
| POST | `/api/orchestration/dispatch` with project.* | operate | **no** — T3 already has `t3 project` |
| POST | `/api/pull-requests/diff` | read | **no** |
| * | `/api/connect/*`, `/oauth/token`, pairing | various | **no** |

HTTP errors are tagged JSON: `invalid_request`, `auth_invalid`, `insufficient_scope`, `not_found` (`thread_not_found`), `internal_error`, plus `traceId`.

### 2.4 WebSocket orchestration RPCs

Current `ORCHESTRATION_WS_METHODS` (`packages/contracts/src/orchestration.ts`):

| RPC | Scope | MVP? |
| --- | --- | --- |
| `orchestration.subscribeShell` | read | **yes** — watch project/thread list |
| `orchestration.subscribeThread` | read | **yes** — watch one thread |
| `orchestration.dispatchCommand` | operate | optional (HTTP dispatch is enough) |
| `orchestration.searchThreads` | read | later |
| `orchestration.getTurnDiff` | read | later |
| `orchestration.getFullThreadDiff` | read | later |
| `orchestration.getArchivedShellSnapshot` | read | later |
| `orchestration.getWorkflowScript` | read | later |

**Removed / never call (Mintlify ghosts):** `orchestration.getSnapshot`, `orchestration.replayEvents`.

Handshake used by official clients (`packages/client-runtime/src/rpc/session.ts`):

1. Open socket (15s open timeout).
2. `subscribeServerConfig` (optional flags: `environmentThemes`, `usageLimitSources`) and wait for a `type: "snapshot"` config event before treating the session as ready.
3. Optional `server.probe` if `capabilities.connectionProbe === true`, else `server.getConfig`.

MVP watch can skip themes/usage flags. Still wait for config snapshot (or at least a successful `server.getConfig` / `server.probe`) so a half-open socket is not reported as healthy.

Subscribe inputs:

```ts
// orchestration.subscribeShell
{ afterSequence?: number, requestCompletionMarker?: boolean }

// orchestration.subscribeThread
{ threadId: string, afterSequence?: number, requestCompletionMarker?: boolean, turnLimit?: number }
```

Stream items (shell): `snapshot` | `synchronized` | `project-upserted` | `project-removed` | `thread-upserted` | `thread-removed`, each with `sequence`.

Resume: pass the last applied `snapshotSequence` / event `sequence` as `afterSequence`. Overlapping events are deduped by sequence. If the gap is too large, the server sends a fallback snapshot. Official clients keep thread cursor + cache together and **do not advance the cursor on cancel**.

Reconnect: mint a **new** 5-minute `wsTicket`, open a new socket, then subscribe with `afterSequence`. Do not reuse an expired ticket.

### 2.5 Dispatch commands (payloads)

`POST /api/orchestration/dispatch` and `orchestration.dispatchCommand` share `ClientOrchestrationCommand`. Success is always `{ sequence: number }`.

**MVP will send:**

#### `thread.create`

```json
{
  "type": "thread.create",
  "commandId": "<uuid>",
  "threadId": "<uuid>",
  "projectId": "<uuid>",
  "title": "…",
  "modelSelection": { "instanceId": "<provider instance slug>", "model": "…" },
  "runtimeMode": "approval-required",
  "interactionMode": "default",
  "branch": null,
  "worktreePath": null,
  "createdAt": "2026-09-08T00:00:00.000Z"
}
```

`modelSelection` is `{ instanceId, model, options? }`. Legacy `{ provider, model }` is still decoded server-side (provider slug promoted to default instance id). Prefer `instanceId` from the shell snapshot / `server.getConfig` provider list.

#### `thread.turn.start`

```json
{
  "type": "thread.turn.start",
  "commandId": "<uuid>",
  "threadId": "<uuid>",
  "message": {
    "messageId": "<uuid>",
    "role": "user",
    "text": "…",
    "attachments": []
  },
  "runtimeMode": "approval-required",
  "interactionMode": "default",
  "createdAt": "2026-09-08T00:00:00.000Z"
}
```

Optional: `modelSelection`, `titleSeed`, `bootstrap.createThread` (create + first turn in one command), `bootstrap.prepareWorktree`, `bootstrap.runSetupScript`. Limits: 120k input chars, 8 attachments. Client-side attachments may be upload refs; MVP is text-only.

Defaults if omitted: `runtimeMode` → **`full-access`**, `interactionMode` → `default`. Always send an explicit `runtimeMode` so agents do not silently get full access.

#### `thread.runtime-mode.set`

```json
{
  "type": "thread.runtime-mode.set",
  "commandId": "<uuid>",
  "threadId": "<uuid>",
  "runtimeMode": "approval-required",
  "createdAt": "2026-09-08T00:00:00.000Z"
}
```

Changing mode can require a provider session restart on the **T3 server**. This CLI only dispatches the command.

#### `thread.turn.interrupt` (MVP-adjacent, ship if cheap)

```json
{
  "type": "thread.turn.interrupt",
  "commandId": "<uuid>",
  "threadId": "<uuid>",
  "createdAt": "2026-09-08T00:00:00.000Z"
}
```

**Deferred dispatch types:** `project.*`, `thread.delete` / `archive` / `settle` / `snooze` / `pin` / `meta.update`, `thread.interaction-mode.set`, `thread.approval.respond`, `thread.user-input.respond` / `dismiss`, `thread.checkpoint.revert`, `thread.session.stop`, and all server-only types (`thread.session.set`, assistant deltas, import, …). Clients must not send server-only types.

### 2.6 Runtime / permission modes (T3-server-side)

Current `RuntimeMode`: `approval-required` | `auto-accept-edits` | `auto` | `full-access`.

Default on the T3 server is **`full-access`**. Official UI copy ([`docs/user/permission-modes.md`](https://github.com/pingdotgg/t3code/blob/main/docs/user/permission-modes.md)):

| Mode | Behavior |
| --- | --- |
| Supervised (`approval-required`) | Approve commands and file changes |
| Auto-accept edits | Edits auto-approved; other actions may still prompt |
| Auto | Provider auto-review (Codex/Claude/Cursor); others fall back to ask |
| Full access | Commands and edits without prompts |

`ProviderSandboxMode` (`read-only` | `workspace-write` | `danger-full-access`) and Codex `--dangerously-skip-permissions` are **provider/session mapping on the T3 server**. This CLI must not invent a skip-permissions flag. It may *select* a `runtimeMode` on create/start/set. Approvals arrive as pending activity on the thread; responding is a later-phase command (`thread.approval.respond`).

### 2.7 Status fields agents should read

From `OrchestrationThreadShell` / `OrchestrationSession`:

- `session.status`: `idle` | `starting` | `running` | `ready` | `interrupted` | `stopped` | `error`
- `session.lastError`, `session.activeTurnId`, `session.runtimeMode`
- `latestTurn.state`: `running` | `interrupted` | `completed` | `error`
- `hasPendingApprovals`, `hasPendingUserInput`, `hasActionableProposedPlan`
- `backgroundLiveness`: `working` | `monitoring` | null
- `planProgress`: `{ step, completedSteps, totalSteps }`
- `snapshotSequence` — resume cursor

`GET /api/orchestration/shell` is the list/status source. Full messages live on `GET /api/orchestration/threads/:id` (optionally windowed).

### 2.8 Environment descriptor (versioning)

`GET /.well-known/t3/environment`:

```ts
{
  environmentId: string,
  label: string,
  platform: { os, arch, machine? },
  serverVersion: string,
  capabilities: {
    connectionProbe?, attachmentUploads?, fileAttachments?,
    pullRequests?, threadSettlement?, threadSnooze?, threadPinning?,
    // … many optional flags; unknown keys must be ignored
  }
}
```

There is **no single WS protocol version number**. Compatibility is `serverVersion` + optional capability flags + schema `optionalKey` / decode defaults. Pin a **T3 contracts SHA** in this repo (start: `6ba15c027a6d411c7f75cc0ca59b601a295c3633`) and bump it deliberately.

---

## 3. MVP command set

Binary name: `t3-agent`. Always emit JSON unless `--human` is passed (human is non-default).

| Command | Behavior | T3 calls |
| --- | --- | --- |
| `t3-agent env` | Descriptor + auth session | `GET /.well-known/t3/environment`, `GET /api/auth/session` |
| `t3-agent threads` | List thread shells (filter `--project`, `--status`) | `GET /api/orchestration/shell` |
| `t3-agent thread get <id>` | Thread detail (`--turns N`) | `GET /api/orchestration/threads/:id` |
| `t3-agent thread create` | Create thread (`--project`, `--title`, `--model`, `--instance`, `--runtime-mode`) | HTTP dispatch `thread.create` |
| `t3-agent turn start` | Start a user turn (`--thread`, `--text` or stdin, `--runtime-mode`) | HTTP dispatch `thread.turn.start` |
| `t3-agent turn interrupt --thread` | Interrupt active turn | HTTP dispatch `thread.turn.interrupt` |
| `t3-agent watch` | NDJSON events until SIGINT (`--thread` optional; else shell) | ticket + WS `subscribeShell` / `subscribeThread` |
| `t3-agent status [--thread]` | Compact status object | shell and/or thread GET |

Global flags / env (see §5): `--url`, `--token`, `--ws-url`, `--timeout`.

Suggested stdout envelope:

```json
{ "ok": true, "t3": { "serverVersion": "…", "environmentId": "…" }, "data": { } }
```

Errors:

```json
{ "ok": false, "error": { "code": "insufficient_scope", "message": "…", "traceId": "…" } }
```

Exit codes: `0` ok, `1` usage, `2` auth, `3` not found, `4` transport, `5` dispatch rejected.

---

## 4. Architecture

```
t3-agent CLI
  ├─ config.ts          url / token / timeouts (env > flags > file)
  ├─ http/
  │    ├─ client.ts     fetch + Bearer + error mapping
  │    ├─ auth.ts       session, websocket-ticket
  │    └─ orchestration.ts  shell, thread, dispatch
  ├─ ws/
  │    ├─ ticket.ts     mint ticket, build /ws?wsTicket=
  │    ├─ rpc.ts        Effect RPC JSON session (or thin adapter)
  │    └─ subscribe.ts  subscribeShell / subscribeThread + afterSequence
  ├─ commands/          env, threads, thread, turn, watch, status
  └─ output.ts          JSON envelope (--human later)
```

HTTP-first: list/read/start work with **zero** WebSocket. Watch is the only command that must speak Effect RPC.

Do not vendor T3's full `client-runtime` (supervisor, projections, React). Copy the **auth + ticket + subscribe cursor** rules, not the UI state machine.

`@t3tools/contracts` is **private** (`"private": true` in T3's package.json) and is not on npm. Options:

1. **Vendor a typed subset** of HTTP/command schemas (recommended for MVP).
2. Depend on a git submodule of `packages/contracts` (heavy; Effect catalog versions).
3. Wait for T3 to publish contracts (do not block MVP).

---

## 5. Auth and config

**No Helsinki (or any host) credentials in this repo.** Document names only.

| Source | Keys |
| --- | --- |
| Env | `T3_AGENT_URL` (https origin), `T3_AGENT_TOKEN` (bearer), `T3_AGENT_WS_URL` (optional; default: url with `http→ws` + `/ws`) |
| Flags | `--url`, `--token`, `--ws-url` |
| File (later) | `~/.config/t3-agent/config.json` — `{ "url", "token" }` with `0600` |

Resolution: flags > env > file. Refuse to run if url or token is missing (except a future `--help`).

Token acquisition stays on the T3 host:

```bash
export T3_AGENT_URL="https://t3.example.internal"
export T3_AGENT_TOKEN="$(ssh host 't3 auth session issue --token-only')"
t3-agent threads
```

`--token-only` prints the raw bearer. Prefer `--json` in scripts so expiry/scopes are visible.

Never log the bearer or `wsTicket`. Redact `Authorization` in debug dumps.

---

## 6. Protocol versioning strategy

1. **Pin** `T3_CONTRACTS_REF=6ba15c027a6d411c7f75cc0ca59b601a295c3633` in this plan / a `docs/CONTRACTS.md` bump note when schemas change.
2. On connect, read `serverVersion` + `capabilities`. Put both on every JSON envelope.
3. **Feature-gate** optional commands on capabilities (`threadSettlement`, `threadSnooze`, `connectionProbe`, …). Unknown capability keys: ignore.
4. Treat Mintlify as illustrative only. Source of truth: `packages/contracts/src/{orchestration,environmentHttp,auth,rpc}.ts` and `apps/server/src/auth/RpcAuthorization.ts`.
5. Subscribe resume = `afterSequence`, not a custom replay API.
6. WS tickets expire in ~5 minutes: mint immediately before `watch`, remint on reconnect. Session bearer is the long-lived secret.
7. Schema drift: keep decode **lenient** (ignore unknown fields) and encode **strict** (only fields we understand). Fail closed on missing required fields (`threadId`, `commandId`, `type`).
8. If T3 re-adds a WS `getSnapshot`, do not switch until this pin is bumped and HTTP still works.

---

## 7. Packaging (language / runtime)

**Recommendation: TypeScript on Node 22+, shipped as `@milind220/t3-agent` (or `t3-agent`) on npm, `type: module`.**

Rationale:

- T3's contracts, HTTP API, and WS RPC are Effect/TypeScript. A follow-up that speaks subscribe without re-deriving Effect RPC framing is much cheaper in TS (`effect` + `RpcClient.makeProtocolSocket` + `layerJson`) than in Go/Rust.
- MVP can be **fetch-only** (Node 22 native `fetch` + `WebSocket`) and add Effect only for `watch`.
- Agents already run Node; JSON-first CLIs (citty / commander / gunshi) are a good fit.
- Single-binary Go would be nicer to install, but the unpublished Effect RPC wire format is the risky part of `watch`. HTTP-only Go is a later optional port, not the first implementation.

Not chosen for MVP:

- **Python**: fine for HTTP, poor Effect RPC interop.
- **Depending on unpublished `@t3tools/contracts`**: breaks installs.
- **Bundling T3 server**: out of scope; this is a client.

Dev: `pnpm` or `npm`, `tsx` for local runs, `vitest` for tests. Optional later: compile with `tsdown` / `bun build` to a single file.

---

## 8. Testing against a T3 server

### 8.1 Unit (no T3)

- Config resolution (flags/env/file).
- Command payload builders (`commandId` / `threadId` / ISO timestamps).
- HTTP error mapping fixtures (copy tagged error JSON from T3 schemas).
- Subscribe cursor: do not advance on cancel; dedupe by sequence.

### 8.2 Local integration (documented, not CI-default)

On a machine with T3:

```bash
# terminal 1
t3 --host 127.0.0.1 --port 8080 --no-browser

# terminal 2
export T3_AGENT_URL=http://127.0.0.1:8080
export T3_AGENT_TOKEN="$(t3 auth session issue --token-only)"
t3-agent env
t3-agent threads
t3-agent thread create --project <id> --title "agent-smoke" --runtime-mode approval-required
t3-agent turn start --thread <id> --text "reply with pong"
t3-agent thread get <id>
t3-agent watch --thread <id>
```

Need at least one project (T3 web UI or `t3 project add`). Do not require a provider API key for `env` / `threads`; `turn start` needs a configured provider instance.

### 8.3 Remote / Helsinki

Same env vars against a reachable origin (`https://…`). Use a **session token issued on that host**. Never store Helsinki URLs or tokens in the repo, examples, or CI logs. Optional GitHub Actions: repository secrets only, workflow `workflow_dispatch`, not on every PR.

### 8.4 Contract drift check (later)

A script that fetches `pingdotgg/t3code` `packages/contracts/src/orchestration.ts` at `T3_CONTRACTS_REF` and greps that MVP method names still exist.

---

## 9. Non-goals

- Forking or vendoring `pingdotgg/t3code`.
- Implementing the T3 server, providers, checkpoints, or sandboxes.
- `--dangerously-skip-permissions` / changing host sandbox policy.
- T3 Connect / DPoP / pairing UX (unless a later phase needs relay).
- Terminal, git, PR, preview, attachment upload, MCP, or desktop IPC.
- A web UI, daemon, or long-running agent runtime (memory / Cursor spawn lives elsewhere).
- Publishing Helsinki credentials or a default production URL.
- Merging to T3 upstream in this repo's MVP.

---

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| **Protocol drift** vs T3 versions; Mintlify is already wrong (`getSnapshot` WS gone). | Pin SHA; HTTP-first; capability flags; lenient decode. |
| **Effect RPC wire format** is not a documented public JSON-RPC. | Isolate in `ws/rpc.ts`; HTTP covers list/read/start; consider Effect for watch. |
| **`@t3tools/contracts` unpublished.** | Vendor a subset; do not npm-depend on it. |
| **WS ticket TTL 5 minutes.** | Mint per `watch` / reconnect; never persist tickets. |
| **Default `runtimeMode` is `full-access`.** | Always send explicit mode; document that skip-permissions is T3-server-side. |
| **Origin vs GitHub.** | Ship PRs to **https://github.com/Milind220/t3-agent**. Cursor Origin (`milinds/t3-agent`) is a mirror; cloud agents should target GitHub. |
| **Scope / 403.** | `env` prints granted scopes; operate commands require `orchestration:operate`. |
| **DPoP-bound tokens** from relay pairing. | Detect `auth_invalid` + `dpopFailureReason`; tell the user to use `t3 auth session issue` bearer. |
| **Model `instanceId` vs legacy `provider`.** | Prefer instance ids from shell/config. |
| **Resume cursor vs cancelled watch.** | Store sequence only after a fully applied event. |

---

## 11. Phased milestones

### Phase 0 — this PR

Plan docs + README. No CLI.

### Phase 1 — MVP (follow-up agent)

1. TS package skeleton, JSON CLI framework, config/env.
2. HTTP client: environment, session, shell, thread get, dispatch.
3. Commands: `env`, `threads`, `thread get`, `thread create`, `turn start`, `status`.
4. Tests with mocked HTTP.
5. README: how to issue a token and point at local T3.

### Phase 2 — watch + polish

1. Ticket + WebSocket + `subscribeShell` / `subscribeThread` (`watch`).
2. `turn interrupt`, `--human`, config file, NDJSON for long watches.
3. Local integration script (documented).
4. Contract-pin grep / SHA bump process.

### Phase 3 — optional agent niceties

Approvals (`thread.approval.respond`), user-input, `searchThreads`, diffs, windowed `turnLimit` pagination, `thread.session.stop`.

### Phase 4 — optional upstream `t3 agent`

T3's CLI already has `auth`, `project`, `connect`, `pair` — not thread/turn. A later PR to **pingdotgg/t3code** could add `t3 agent` as a thin wrapper around the same HTTP/WS calls (or depend on this package). Keep this repo independent until T3 wants it in-tree. Do not open that PR until MVP is proven against a live server.

---

## 12. Implementation notes for the next agent

Copy-paste sequence (do not re-derive):

```
# 1. Host
t3 auth session issue --json
# → token

# 2. Client HTTP
GET  $URL/.well-known/t3/environment
GET  $URL/api/auth/session
     Authorization: Bearer $TOKEN
GET  $URL/api/orchestration/shell
     Authorization: Bearer $TOKEN
GET  $URL/api/orchestration/threads/$THREAD_ID
     Authorization: Bearer $TOKEN
POST $URL/api/orchestration/dispatch
     Authorization: Bearer $TOKEN
     Content-Type: application/json
     { "type": "thread.turn.start", "commandId", "threadId", "message": {…}, "runtimeMode", "interactionMode", "createdAt" }

# 3. Watch
POST $URL/api/auth/websocket-ticket
     Authorization: Bearer $TOKEN
     → { ticket, expiresAt }
WS   $WS_URL/ws?wsTicket=$TICKET
     Effect RPC: wait for server config snapshot
     orchestration.subscribeThread { threadId, afterSequence? }
```

Generate `commandId`, `threadId`, `messageId` as UUIDs. `createdAt` is ISO-8601 UTC.

Official reference implementations (read, do not fork):

- HTTP dispatch: `apps/server/src/cli/project.ts`
- Ticket + WS URL: `packages/client-runtime/src/authorization/remote.ts`
- RPC session: `packages/client-runtime/src/rpc/session.ts`
- Command builders: `packages/client-runtime/src/operations/commands.ts`

---

## 13. Open blockers in T3's public API

These are constraints, not show-stoppers for HTTP MVP:

1. **Mintlify ≠ source.** `orchestration.getSnapshot` / `replayEvents` / `?token=` upgrade are outdated. Implement from `packages/contracts`.
2. **Effect RPC is the WS protocol**; there is no stable public “raw JSON-RPC” spec. Watch is the hard part.
3. **Contracts package is private** — no npm import.
4. **Capability flags are additive and incomplete** on old servers; treat absence as “unknown / don’t send the new command.”
5. **No public headless thread CLI** in T3 today (`t3 project` only). That is the gap this repo fills.
6. **Helsinki / remote reachability** is an ops problem (URL + issued token), not an API gap. This repo must not require those secrets.
