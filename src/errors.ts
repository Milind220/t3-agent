import type { T3ErrorBody } from "./types.js";

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_AUTH = 2;
export const EXIT_NOT_FOUND = 3;
export const EXIT_TRANSPORT = 4;
export const EXIT_DISPATCH = 5;

export type AgentErrorCode =
  | "usage"
  | "config"
  | "invalid_request"
  | "auth_invalid"
  | "insufficient_scope"
  | "operation_forbidden"
  | "not_found"
  | "internal_error"
  | "transport"
  | "timeout"
  | "dispatch_rejected"
  | "unexpected";

export class AgentError extends Error {
  readonly code: AgentErrorCode;
  readonly exitCode: number;
  readonly traceId?: string;
  readonly details?: Record<string, unknown>;

  constructor(input: {
    code: AgentErrorCode;
    message: string;
    exitCode: number;
    traceId?: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(input.message, input.cause !== undefined ? { cause: input.cause } : undefined);
    this.name = "AgentError";
    this.code = input.code;
    this.exitCode = input.exitCode;
    if (input.traceId !== undefined) this.traceId = input.traceId;
    if (input.details !== undefined) this.details = input.details;
  }
}

export function usageError(message: string, details?: Record<string, unknown>): AgentError {
  return new AgentError({
    code: "usage",
    message,
    exitCode: EXIT_USAGE,
    ...(details !== undefined ? { details } : {}),
  });
}

export function configError(message: string): AgentError {
  return new AgentError({
    code: "config",
    message,
    exitCode: EXIT_USAGE,
  });
}

export function transportError(message: string, cause?: unknown): AgentError {
  const timeout = /timeout|aborted|AbortError/i.test(message) || isAbortError(cause);
  return new AgentError({
    code: timeout ? "timeout" : "transport",
    message,
    exitCode: EXIT_TRANSPORT,
    ...(cause !== undefined ? { cause } : {}),
  });
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name: string }).name === "AbortError")
  );
}

export function errorFromHttpStatus(
  status: number,
  body: T3ErrorBody | undefined,
  fallbackText: string,
): AgentError {
  const code = (body?.code ?? inferCodeFromStatus(status)) as AgentErrorCode;
  const traceId = typeof body?.traceId === "string" ? body.traceId : undefined;
  const reason = typeof body?.reason === "string" ? body.reason : undefined;
  const requiredScope =
    typeof body?.requiredScope === "string" ? body.requiredScope : undefined;
  const dpopFailureReason =
    typeof body?.dpopFailureReason === "string" ? body.dpopFailureReason : undefined;

  const message = composeHttpMessage({
    status,
    body,
    fallbackText,
    reason,
    requiredScope,
    dpopFailureReason,
  });

  const details: Record<string, unknown> = { status };
  if (reason) details.reason = reason;
  if (requiredScope) details.requiredScope = requiredScope;
  if (dpopFailureReason) details.dpopFailureReason = dpopFailureReason;
  if (body?._tag) details.tag = body._tag;

  return new AgentError({
    code: isKnownCode(code) ? code : "unexpected",
    message,
    exitCode: exitCodeForHttp(status, code),
    ...(traceId !== undefined ? { traceId } : {}),
    details,
  });
}

function inferCodeFromStatus(status: number): AgentErrorCode {
  if (status === 400) return "invalid_request";
  if (status === 401) return "auth_invalid";
  if (status === 403) return "insufficient_scope";
  if (status === 404) return "not_found";
  if (status >= 500) return "internal_error";
  return "unexpected";
}

function exitCodeForHttp(status: number, code: string): number {
  if (status === 401 || code === "auth_invalid") return EXIT_AUTH;
  if (status === 403 || code === "insufficient_scope" || code === "operation_forbidden") {
    return EXIT_AUTH;
  }
  if (status === 404 || code === "not_found") return EXIT_NOT_FOUND;
  if (status === 400 || code === "invalid_request") return EXIT_DISPATCH;
  if (status >= 500 || code === "internal_error") return EXIT_DISPATCH;
  return EXIT_DISPATCH;
}

function isKnownCode(code: string): code is AgentErrorCode {
  return (
    code === "usage" ||
    code === "config" ||
    code === "invalid_request" ||
    code === "auth_invalid" ||
    code === "insufficient_scope" ||
    code === "operation_forbidden" ||
    code === "not_found" ||
    code === "internal_error" ||
    code === "transport" ||
    code === "timeout" ||
    code === "dispatch_rejected" ||
    code === "unexpected"
  );
}

function composeHttpMessage(input: {
  status: number;
  body: T3ErrorBody | undefined;
  fallbackText: string;
  reason?: string;
  requiredScope?: string;
  dpopFailureReason?: string;
}): string {
  if (input.dpopFailureReason) {
    return `T3 rejected this bearer token as proof-bound (${input.dpopFailureReason}). Issue a session with \`t3 auth session issue\` on the T3 host instead of a DPoP/pairing token.`;
  }
  if (input.body?.code === "insufficient_scope" || input.requiredScope) {
    return `This request needs the ${input.requiredScope ?? "required"} scope, which this session does not have.`;
  }
  if (typeof input.body?.message === "string" && input.body.message.trim().length > 0) {
    return input.body.message;
  }
  if (input.reason) {
    return `T3 HTTP ${input.status} (${input.body?.code ?? "error"}: ${input.reason}).`;
  }
  if (typeof input.body?.code === "string") {
    return `T3 HTTP ${input.status} (${input.body.code}).`;
  }
  const snippet = input.fallbackText.trim().slice(0, 200);
  return snippet.length > 0
    ? `T3 HTTP ${input.status}: ${snippet}`
    : `T3 HTTP ${input.status}.`;
}
