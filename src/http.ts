import { CLI_NAME, CLI_VERSION } from "./version.js";
import type { ResolvedConfig } from "./config.js";
import { AgentError, errorFromHttpStatus, isAbortError, transportError } from "./errors.js";
import type {
  AuthSessionState,
  ClientOrchestrationCommand,
  DispatchResult,
  ExecutionEnvironmentDescriptor,
  OrchestrationShellSnapshot,
  OrchestrationThreadDetailSnapshot,
  T3EnvelopeMeta,
  T3ErrorBody,
} from "./types.js";

export type FetchLike = typeof fetch;

export type ThreadGetQuery = {
  turnLimit?: number;
  beforeCursor?: string;
};

export class T3HttpClient {
  readonly config: ResolvedConfig;
  private readonly fetchFn: FetchLike;
  private environmentCache: ExecutionEnvironmentDescriptor | undefined;

  constructor(config: ResolvedConfig, fetchFn: FetchLike = fetch) {
    this.config = config;
    this.fetchFn = fetchFn;
  }

  async getEnvironment(): Promise<ExecutionEnvironmentDescriptor> {
    if (this.environmentCache) return this.environmentCache;
    const descriptor = await this.request<ExecutionEnvironmentDescriptor>(
      "GET",
      "/.well-known/t3/environment",
      { auth: false },
    );
    if (typeof descriptor.environmentId !== "string" || typeof descriptor.serverVersion !== "string") {
      throw transportError("T3 environment descriptor is missing environmentId or serverVersion.");
    }
    this.environmentCache = descriptor;
    return descriptor;
  }

  async getSession(): Promise<AuthSessionState> {
    return this.request<AuthSessionState>("GET", "/api/auth/session");
  }

  async getShell(): Promise<OrchestrationShellSnapshot> {
    return this.request<OrchestrationShellSnapshot>("GET", "/api/orchestration/shell");
  }

  async getThread(
    threadId: string,
    query: ThreadGetQuery = {},
  ): Promise<OrchestrationThreadDetailSnapshot> {
    const search = new URLSearchParams();
    if (query.turnLimit !== undefined) search.set("turnLimit", String(query.turnLimit));
    if (query.beforeCursor) search.set("beforeCursor", query.beforeCursor);
    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    return this.request<OrchestrationThreadDetailSnapshot>(
      "GET",
      `/api/orchestration/threads/${encodeURIComponent(threadId)}${suffix}`,
    );
  }

  async dispatch(command: ClientOrchestrationCommand): Promise<DispatchResult> {
    return this.request<DispatchResult>("POST", "/api/orchestration/dispatch", {
      body: command,
    });
  }

  async envelopeMeta(): Promise<T3EnvelopeMeta> {
    const env = await this.getEnvironment();
    return {
      serverVersion: env.serverVersion,
      environmentId: env.environmentId,
      capabilities: env.capabilities ?? {},
    };
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const url = `${this.config.url}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": `${CLI_NAME}/${CLI_VERSION}`,
    };
    if (options.auth !== false) {
      headers.Authorization = `Bearer ${this.config.token}`;
    }
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw transportError(`Request timed out after ${this.config.timeoutMs}ms: ${method} ${path}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw transportError(`Failed to reach T3 at ${this.config.url}: ${message}`, error);
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    const parsed = parseJson(text);

    if (!response.ok) {
      throw errorFromHttpStatus(
        response.status,
        isErrorBody(parsed) ? parsed : undefined,
        text,
      );
    }

    if (parsed === undefined) {
      throw transportError(`T3 returned a non-JSON ${response.status} body for ${method} ${path}.`);
    }
    return parsed as T;
  }
}

function parseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isErrorBody(value: unknown): value is T3ErrorBody {
  return typeof value === "object" && value !== null;
}

export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}
