import { configError } from "./errors.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

export type ConfigSources = {
  url?: string;
  token?: string;
  wsUrl?: string;
  timeoutMs?: number;
};

export type ResolvedConfig = {
  url: string;
  token: string;
  wsUrl: string;
  timeoutMs: number;
};

export type EnvReader = {
  T3_AGENT_URL?: string | undefined;
  T3_AGENT_TOKEN?: string | undefined;
  T3_AGENT_WS_URL?: string | undefined;
  T3_AGENT_TIMEOUT_MS?: string | undefined;
};

/** Flags override env. Config file is deferred (Phase 2). */
export function resolveConfig(
  flags: ConfigSources,
  env: EnvReader = process.env,
): ResolvedConfig {
  const urlRaw = firstNonEmpty(flags.url, env.T3_AGENT_URL);
  const tokenRaw = firstNonEmpty(flags.token, env.T3_AGENT_TOKEN);
  const wsRaw = firstNonEmpty(flags.wsUrl, env.T3_AGENT_WS_URL);
  const timeoutRaw =
    flags.timeoutMs ?? parseTimeout(env.T3_AGENT_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS;

  if (!urlRaw) {
    throw configError(
      "Missing T3 origin. Set --url or T3_AGENT_URL (example: http://127.0.0.1:8080).",
    );
  }
  if (!tokenRaw) {
    throw configError(
      "Missing bearer token. Set --token or T3_AGENT_TOKEN from `t3 auth session issue` on the T3 host.",
    );
  }

  const url = normalizeHttpOrigin(urlRaw);
  const wsUrl = wsRaw ? normalizeWsUrl(wsRaw) : deriveWsUrl(url);
  const timeoutMs = timeoutRaw;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw configError("Timeout must be a positive number of milliseconds.");
  }

  return { url, token: tokenRaw, wsUrl, timeoutMs };
}

export function deriveWsUrl(httpOrigin: string): string {
  const parsed = new URL(httpOrigin);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = "/ws";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function normalizeHttpOrigin(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw configError(`Invalid T3 origin URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw configError(`T3 origin must be http(s), got ${parsed.protocol}`);
  }
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizeWsUrl(value: string): string {
  const trimmed = value.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw configError(`Invalid T3 WebSocket URL: ${trimmed}`);
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw configError(`T3 WebSocket URL must be ws(s), got ${parsed.protocol}`);
  }
  return parsed.toString();
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

function parseTimeout(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
