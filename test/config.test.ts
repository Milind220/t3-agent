import { describe, expect, it } from "vitest";
import { deriveWsUrl, resolveConfig } from "../src/config.js";
import { AgentError } from "../src/errors.js";

describe("resolveConfig", () => {
  it("prefers flags over env", () => {
    const config = resolveConfig(
      { url: "https://flag.example:8443/", token: "flag-token" },
      {
        T3_AGENT_URL: "http://127.0.0.1:8080",
        T3_AGENT_TOKEN: "env-token",
      },
    );
    expect(config.url).toBe("https://flag.example:8443");
    expect(config.token).toBe("flag-token");
    expect(config.wsUrl).toBe("wss://flag.example:8443/ws");
  });

  it("falls back to env when flags are omitted", () => {
    const config = resolveConfig(
      {},
      {
        T3_AGENT_URL: "http://127.0.0.1:8080",
        T3_AGENT_TOKEN: "env-token",
        T3_AGENT_WS_URL: "ws://127.0.0.1:8080/custom-ws",
      },
    );
    expect(config.url).toBe("http://127.0.0.1:8080");
    expect(config.token).toBe("env-token");
    expect(config.wsUrl).toBe("ws://127.0.0.1:8080/custom-ws");
  });

  it("rejects missing url or token", () => {
    expect(() => resolveConfig({}, {})).toThrow(AgentError);
    expect(() => resolveConfig({ url: "http://127.0.0.1:8080" }, {})).toThrow(
      /Missing bearer token/,
    );
  });

  it("rejects non-http origins", () => {
    expect(() =>
      resolveConfig({ url: "ftp://example", token: "t" }, {}),
    ).toThrow(/must be http/);
  });
});

describe("deriveWsUrl", () => {
  it("maps http to ws /ws", () => {
    expect(deriveWsUrl("http://127.0.0.1:8080")).toBe("ws://127.0.0.1:8080/ws");
  });

  it("maps https to wss /ws", () => {
    expect(deriveWsUrl("https://t3.example.internal")).toBe("wss://t3.example.internal/ws");
  });
});
