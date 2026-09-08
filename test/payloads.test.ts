import { describe, expect, it } from "vitest";
import { AgentError } from "../src/errors.js";
import {
  buildThreadCreateCommand,
  buildTurnInterruptCommand,
  buildTurnStartCommand,
  parseRuntimeMode,
  resolveModelSelection,
} from "../src/payloads.js";

describe("payload builders", () => {
  it("builds thread.create with explicit runtimeMode", () => {
    const command = buildThreadCreateCommand({
      projectId: "proj-1",
      title: "agent-smoke",
      modelSelection: { instanceId: "openai", model: "gpt-5" },
      threadId: "thread-1",
      commandId: "cmd-1",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    expect(command).toEqual({
      type: "thread.create",
      commandId: "cmd-1",
      threadId: "thread-1",
      projectId: "proj-1",
      title: "agent-smoke",
      modelSelection: { instanceId: "openai", model: "gpt-5" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  });

  it("builds thread.turn.start with empty attachments and explicit runtimeMode", () => {
    const command = buildTurnStartCommand({
      threadId: "thread-1",
      text: "reply with pong",
      commandId: "cmd-2",
      messageId: "msg-1",
      createdAt: "2026-09-08T00:00:00.000Z",
      runtimeMode: "auto-accept-edits",
    });
    expect(command.type).toBe("thread.turn.start");
    expect(command.runtimeMode).toBe("auto-accept-edits");
    expect(command.interactionMode).toBe("default");
    expect(command.message).toEqual({
      messageId: "msg-1",
      role: "user",
      text: "reply with pong",
      attachments: [],
    });
  });

  it("builds thread.turn.interrupt", () => {
    const command = buildTurnInterruptCommand({
      threadId: "thread-1",
      commandId: "cmd-3",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
    expect(command).toEqual({
      type: "thread.turn.interrupt",
      commandId: "cmd-3",
      threadId: "thread-1",
      createdAt: "2026-09-08T00:00:00.000Z",
    });
  });

  it("rejects unknown runtime modes", () => {
    expect(() => parseRuntimeMode("skip-permissions")).toThrow(AgentError);
  });

  it("rejects empty turn text", () => {
    expect(() => buildTurnStartCommand({ threadId: "t", text: "   " })).toThrow(
      /Turn text is empty/,
    );
  });

  it("promotes legacy provider slug to instanceId", () => {
    expect(
      resolveModelSelection({
        fallback: { provider: "openai", model: "gpt-5" },
      }),
    ).toEqual({ instanceId: "openai", model: "gpt-5" });
  });
});
