import { describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config.js";
import { AgentError, EXIT_AUTH, EXIT_NOT_FOUND } from "../src/errors.js";
import { T3HttpClient } from "../src/http.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function clientWith(
  handler: (input: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const config = resolveConfig({
    url: "http://127.0.0.1:8080",
    token: "test-token",
  });
  const fetchFn: typeof fetch = async (input, init) => handler(String(input), init);
  return new T3HttpClient(config, fetchFn);
}

describe("T3HttpClient", () => {
  it("GETs environment without Authorization and maps the descriptor", async () => {
    const seen: Array<{ url: string; auth?: string | null }> = [];
    const client = clientWith((url, init) => {
      const headers = new Headers(init?.headers);
      seen.push({ url, auth: headers.get("authorization") });
      return jsonResponse(200, {
        environmentId: "env-1",
        label: "local",
        platform: { os: "linux", arch: "x64" },
        serverVersion: "0.1.2",
        capabilities: { connectionProbe: true },
      });
    });

    const env = await client.getEnvironment();
    expect(env.environmentId).toBe("env-1");
    expect(seen[0]?.url).toBe("http://127.0.0.1:8080/.well-known/t3/environment");
    expect(seen[0]?.auth).toBeNull();
  });

  it("sends Bearer on session, shell, thread, and dispatch", async () => {
    const seen: string[] = [];
    const client = clientWith((url, init) => {
      const headers = new Headers(init?.headers);
      seen.push(`${init?.method ?? "GET"} ${url} ${headers.get("authorization")}`);
      if (url.endsWith("/api/auth/session")) {
        return jsonResponse(200, { authenticated: true, scopes: ["orchestration:read"] });
      }
      if (url.endsWith("/api/orchestration/shell")) {
        return jsonResponse(200, {
          snapshotSequence: 1,
          projects: [],
          threads: [],
          updatedAt: "2026-09-08T00:00:00.000Z",
        });
      }
      if (url.includes("/api/orchestration/threads/")) {
        expect(url).toContain("turnLimit=3");
        expect(url).toContain("beforeCursor=abc");
        return jsonResponse(200, {
          snapshotSequence: 2,
          thread: { id: "thr-1", messages: [] },
        });
      }
      if (url.endsWith("/api/orchestration/dispatch")) {
        const body = JSON.parse(String(init?.body)) as { type: string; runtimeMode: string };
        expect(body.type).toBe("thread.turn.start");
        expect(body.runtimeMode).toBe("approval-required");
        return jsonResponse(200, { sequence: 9 });
      }
      return jsonResponse(404, { code: "not_found", reason: "thread_not_found", traceId: "t" });
    });

    await client.getSession();
    await client.getShell();
    await client.getThread("thr-1", { turnLimit: 3, beforeCursor: "abc" });
    const dispatched = await client.dispatch({
      type: "thread.turn.start",
      commandId: "c",
      threadId: "thr-1",
      message: { messageId: "m", role: "user", text: "hi", attachments: [] },
      runtimeMode: "approval-required",
      interactionMode: "default",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    expect(dispatched.sequence).toBe(9);
    expect(seen.every((line) => line.includes("Bearer test-token"))).toBe(true);
  });

  it("maps tagged auth_invalid + DPoP to a clear auth error", async () => {
    const client = clientWith(() =>
      jsonResponse(401, {
        _tag: "EnvironmentAuthInvalidError",
        code: "auth_invalid",
        reason: "invalid_credential",
        dpopFailureReason: "proof_missing",
        traceId: "trace-1",
      }),
    );

    try {
      await client.getSession();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentError);
      const agent = error as AgentError;
      expect(agent.exitCode).toBe(EXIT_AUTH);
      expect(agent.code).toBe("auth_invalid");
      expect(agent.traceId).toBe("trace-1");
      expect(agent.message).toMatch(/t3 auth session issue/);
    }
  });

  it("maps insufficient_scope and not_found", async () => {
    const scopeClient = clientWith(() =>
      jsonResponse(403, {
        code: "insufficient_scope",
        requiredScope: "orchestration:operate",
        traceId: "s",
      }),
    );
    await expect(scopeClient.dispatch({
      type: "thread.turn.interrupt",
      commandId: "c",
      threadId: "t",
      createdAt: "2026-09-08T00:00:00.000Z",
    })).rejects.toMatchObject({
      code: "insufficient_scope",
      exitCode: EXIT_AUTH,
    });

    const missing = clientWith(() =>
      jsonResponse(404, {
        code: "not_found",
        reason: "thread_not_found",
        traceId: "n",
      }),
    );
    await expect(missing.getThread("missing")).rejects.toMatchObject({
      code: "not_found",
      exitCode: EXIT_NOT_FOUND,
    });
  });

  it("maps network failures to transport errors", async () => {
    const client = clientWith(() => {
      throw new TypeError("fetch failed");
    });
    await expect(client.getEnvironment()).rejects.toMatchObject({
      code: "transport",
      exitCode: 4,
    });
  });
});
