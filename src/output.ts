import { AgentError } from "./errors.js";
import type { T3EnvelopeMeta } from "./types.js";

export type SuccessEnvelope<T> = {
  ok: true;
  t3?: T3EnvelopeMeta;
  data: T;
};

export type ErrorEnvelope = {
  ok: false;
  error: {
    code: string;
    message: string;
    traceId?: string;
    details?: Record<string, unknown>;
  };
};

export function successEnvelope<T>(data: T, t3?: T3EnvelopeMeta): SuccessEnvelope<T> {
  return t3 ? { ok: true, t3, data } : { ok: true, data };
}

export function errorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof AgentError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.traceId !== undefined ? { traceId: error.traceId } : {}),
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      code: "unexpected",
      message,
    },
  };
}

export function writeJson(stream: NodeJS.WritableStream, value: unknown): void {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}
