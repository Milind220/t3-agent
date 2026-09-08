# Smoke test against a remote T3

Issue a session **on the T3 host**, then point this CLI at that origin. Do not commit the token or the hostname.

```bash
# On the T3 host (or via SSH)
t3 auth session issue --json
# optional: t3 auth session issue --token-only
```

```bash
# On the machine that can reach the T3 HTTP origin
export T3_AGENT_URL="https://t3.example.internal"   # replace with your origin
export T3_AGENT_TOKEN="..."                         # bearer from `t3 auth session issue`

# From a clone of this repo
pnpm install
pnpm build
pnpm exec t3-agent --help
pnpm exec t3-agent env --help
pnpm exec t3-agent thread --help
pnpm exec t3-agent turn --help

# Read-only (no provider key required)
pnpm exec t3-agent env
pnpm exec t3-agent threads
pnpm exec t3-agent status

# Needs at least one project on the server (`t3 project add` or the T3 UI)
PROJECT_ID="<project-id-from-threads>"
pnpm exec t3-agent thread create \
  --project "$PROJECT_ID" \
  --title "agent-smoke" \
  --runtime-mode approval-required

THREAD_ID="<thread-id from the create JSON data.command.threadId>"
pnpm exec t3-agent turn start \
  --thread "$THREAD_ID" \
  --text "reply with pong" \
  --runtime-mode approval-required

pnpm exec t3-agent thread get "$THREAD_ID"
pnpm exec t3-agent status --thread "$THREAD_ID"
```

`turn start` needs a configured provider instance on the T3 server. `env` / `threads` / `thread get` do not.

Equivalent one-liners with flags instead of env:

```bash
pnpm exec t3-agent --url "$T3_AGENT_URL" --token "$T3_AGENT_TOKEN" env
```

JSON is the default stdout. Failures are JSON on stderr with a non-zero exit:

| Exit | Meaning |
| --- | --- |
| 0 | ok |
| 1 | usage / missing config |
| 2 | auth / insufficient scope / DPoP-bound token |
| 3 | not found |
| 4 | transport / timeout |
| 5 | dispatch rejected / server error |

If you see `dpopFailureReason`, the token is proof-bound. Re-issue with `t3 auth session issue` (bearer), not a pairing/DPoP token.
