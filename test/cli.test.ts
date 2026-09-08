import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { EXIT_OK, EXIT_USAGE } from "../src/errors.js";
import { runCli, type CliIo } from "../src/main.js";

type Route = {
  method?: string;
  path: string | RegExp;
  status?: number;
  body: unknown;
};

async function run(
  argv: string[],
  routes: Route[],
  env: CliIo["env"] = {
    T3_AGENT_URL: "http://127.0.0.1:8080",
    T3_AGENT_TOKEN: "tok",
  },
  stdinText = "",
): Promise<{ code: number; stdout: string; stderr: string; calls: string[] }> {
  const calls: string[] = [];
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  if (stdinText) stdin.end(stdinText);
  else {
    Object.defineProperty(stdin, "isTTY", { value: true });
    stdin.end();
  }

  const outP = new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    stdout.on("data", (c) => chunks.push(Buffer.from(c)));
    stdout.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
  const errP = new Promise<string>((resolve) => {
    const chunks: Buffer[] = [];
    stderr.on("data", (c) => chunks.push(Buffer.from(c)));
    stderr.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });

  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push(`${method} ${url.pathname}${url.search}`);
    const route = routes.find((item) => {
      const methodOk = !item.method || item.method === method;
      const pathOk =
        typeof item.path === "string"
          ? url.pathname === item.path
          : item.path.test(url.pathname);
      return methodOk && pathOk;
    });
    if (!route) {
      return new Response(JSON.stringify({ code: "not_found", reason: "thread_not_found" }), {
        status: 404,
      });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const code = await runCli(argv, {
    stdout,
    stderr,
    stdin,
    env,
    fetch: fetchFn,
  });
  stdout.end();
  stderr.end();
  return { code, stdout: await outP, stderr: await errP, calls };
}

const environment = {
  environmentId: "env-1",
  label: "local",
  platform: { os: "linux", arch: "x64" },
  serverVersion: "1.2.3",
  capabilities: { threadSettlement: true },
};

const session = {
  authenticated: true,
  scopes: ["orchestration:read", "orchestration:operate"],
  sessionMethod: "bearer-access-token",
};

const shell = {
  snapshotSequence: 4,
  updatedAt: "2026-09-08T00:00:00.000Z",
  projects: [
    {
      id: "proj-1",
      title: "demo",
      workspaceRoot: "/tmp/demo",
      defaultModelSelection: { instanceId: "openai", model: "gpt-5" },
    },
  ],
  threads: [
    {
      id: "thr-1",
      projectId: "proj-1",
      title: "hello",
      runtimeMode: "approval-required",
      session: { status: "idle", lastError: null, activeTurnId: null },
      latestTurn: { state: "completed" },
      hasPendingApprovals: false,
    },
  ],
};

const commonRoutes: Route[] = [
  { path: "/.well-known/t3/environment", body: environment },
  { path: "/api/auth/session", body: session },
  { path: "/api/orchestration/shell", body: shell },
  { path: "/api/orchestration/threads/thr-1", body: { snapshotSequence: 4, thread: { id: "thr-1" } } },
  { method: "POST", path: "/api/orchestration/dispatch", body: { sequence: 11 } },
];

describe("runCli", () => {
  it("prints help without requiring credentials", async () => {
    const result = await run(["--help"], [], {});
    expect(result.code).toBe(EXIT_OK);
    expect(result.stdout).toMatch(/Usage: t3-agent/);
    expect(result.stdout).toMatch(/env/);
    expect(result.stdout).toMatch(/threads/);
  });

  it("prints subcommand help", async () => {
    const thread = await run(["thread", "--help"], [], {});
    expect(thread.code).toBe(EXIT_OK);
    expect(thread.stdout).toMatch(/get/);
    expect(thread.stdout).toMatch(/create/);

    const get = await run(["thread", "get", "--help"], [], {});
    expect(get.stdout).toMatch(/--turns/);

    const create = await run(["thread", "create", "--help"], [], {});
    expect(create.stdout).toMatch(/--runtime-mode/);

    const turn = await run(["turn", "start", "--help"], [], {});
    expect(turn.stdout).toMatch(/--text/);
  });

  it("fails closed when url/token are missing", async () => {
    const result = await run(["env"], [], {});
    expect(result.code).toBe(EXIT_USAGE);
    const parsed = JSON.parse(result.stderr) as { ok: boolean; error: { code: string } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe("config");
  });

  it("runs env against HTTP routes", async () => {
    const result = await run(["env"], commonRoutes);
    expect(result.code).toBe(0);
    expect(result.calls).toContain("GET /.well-known/t3/environment");
    expect(result.calls).toContain("GET /api/auth/session");
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      t3: { serverVersion: string };
      data: { session: { authenticated: boolean } };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.t3.serverVersion).toBe("1.2.3");
    expect(parsed.data.session.authenticated).toBe(true);
  });

  it("lists and filters threads", async () => {
    const all = await run(["threads"], commonRoutes);
    expect(JSON.parse(all.stdout).data.threads).toHaveLength(1);
    const filtered = await run(["threads", "--status", "running"], commonRoutes);
    expect(JSON.parse(filtered.stdout).data.threads).toHaveLength(0);
  });

  it("gets a thread and starts a turn with explicit runtimeMode", async () => {
    const result = await run(
      ["turn", "start", "--thread", "thr-1", "--text", "pong", "--runtime-mode", "auto"],
      commonRoutes,
    );
    expect(result.code).toBe(0);
    expect(result.calls).toContain("POST /api/orchestration/dispatch");
    const parsed = JSON.parse(result.stdout) as {
      data: { command: { type: string; runtimeMode: string }; result: { sequence: number } };
    };
    expect(parsed.data.command.type).toBe("thread.turn.start");
    expect(parsed.data.command.runtimeMode).toBe("auto");
    expect(parsed.data.result.sequence).toBe(11);
  });

  it("creates a thread using project default model selection", async () => {
    const result = await run(
      ["thread", "create", "--project", "proj-1", "--title", "agent-smoke"],
      commonRoutes,
    );
    expect(result.code).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: { command: { type: string; runtimeMode: string; modelSelection: { instanceId: string } } };
    };
    expect(parsed.data.command.type).toBe("thread.create");
    expect(parsed.data.command.runtimeMode).toBe("approval-required");
    expect(parsed.data.command.modelSelection.instanceId).toBe("openai");
  });

  it("thread get passes turnLimit", async () => {
    const result = await run(["thread", "get", "thr-1", "--turns", "7"], commonRoutes);
    expect(result.code).toBe(0);
    expect(result.calls.some((c) => c.includes("turnLimit=7"))).toBe(true);
  });
});
