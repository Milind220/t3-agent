import { usageError } from "./errors.js";
import { newId, nowIso } from "./ids.js";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  INTERACTION_MODES,
  RUNTIME_MODES,
  type InteractionMode,
  type ModelSelection,
  type RuntimeMode,
  type ThreadCreateCommand,
  type ThreadTurnInterruptCommand,
  type ThreadTurnStartCommand,
} from "./types.js";

export function parseRuntimeMode(value: string | undefined): RuntimeMode {
  const mode = value ?? DEFAULT_RUNTIME_MODE;
  if ((RUNTIME_MODES as readonly string[]).includes(mode)) {
    return mode as RuntimeMode;
  }
  throw usageError(
    `Invalid --runtime-mode '${value}'. Expected one of: ${RUNTIME_MODES.join(", ")}.`,
  );
}

export function parseInteractionMode(value: string | undefined): InteractionMode {
  const mode = value ?? DEFAULT_INTERACTION_MODE;
  if ((INTERACTION_MODES as readonly string[]).includes(mode)) {
    return mode as InteractionMode;
  }
  throw usageError(
    `Invalid --interaction-mode '${value}'. Expected one of: ${INTERACTION_MODES.join(", ")}.`,
  );
}

export function buildThreadCreateCommand(input: {
  projectId: string;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode?: string;
  interactionMode?: string;
  threadId?: string;
  commandId?: string;
  createdAt?: string;
  branch?: string | null;
  worktreePath?: string | null;
}): ThreadCreateCommand {
  const projectId = requireNonEmpty(input.projectId, "--project");
  const title = requireNonEmpty(input.title, "--title");
  const instanceId = requireNonEmpty(input.modelSelection.instanceId, "--instance");
  const model = requireNonEmpty(input.modelSelection.model, "--model");

  return {
    type: "thread.create",
    commandId: input.commandId ?? newId(),
    threadId: input.threadId ?? newId(),
    projectId,
    title,
    modelSelection: { instanceId, model },
    runtimeMode: parseRuntimeMode(input.runtimeMode),
    interactionMode: parseInteractionMode(input.interactionMode),
    branch: input.branch ?? null,
    worktreePath: input.worktreePath ?? null,
    createdAt: input.createdAt ?? nowIso(),
  };
}

export function buildTurnStartCommand(input: {
  threadId: string;
  text: string;
  runtimeMode?: string;
  interactionMode?: string;
  modelSelection?: ModelSelection;
  titleSeed?: string;
  commandId?: string;
  messageId?: string;
  createdAt?: string;
}): ThreadTurnStartCommand {
  const threadId = requireNonEmpty(input.threadId, "--thread");
  const text = input.text;
  if (text.trim().length === 0) {
    throw usageError("Turn text is empty. Pass --text or pipe a message on stdin.");
  }

  const command: ThreadTurnStartCommand = {
    type: "thread.turn.start",
    commandId: input.commandId ?? newId(),
    threadId,
    message: {
      messageId: input.messageId ?? newId(),
      role: "user",
      text,
      attachments: [],
    },
    runtimeMode: parseRuntimeMode(input.runtimeMode),
    interactionMode: parseInteractionMode(input.interactionMode),
    createdAt: input.createdAt ?? nowIso(),
  };

  if (input.modelSelection) {
    command.modelSelection = {
      instanceId: requireNonEmpty(input.modelSelection.instanceId, "--instance"),
      model: requireNonEmpty(input.modelSelection.model, "--model"),
    };
  }
  if (input.titleSeed !== undefined && input.titleSeed.trim().length > 0) {
    command.titleSeed = input.titleSeed.trim();
  }
  return command;
}

export function buildTurnInterruptCommand(input: {
  threadId: string;
  commandId?: string;
  createdAt?: string;
}): ThreadTurnInterruptCommand {
  return {
    type: "thread.turn.interrupt",
    commandId: input.commandId ?? newId(),
    threadId: requireNonEmpty(input.threadId, "--thread"),
    createdAt: input.createdAt ?? nowIso(),
  };
}

export function resolveModelSelection(input: {
  instanceId?: string;
  model?: string;
  fallback?: ModelSelection | { provider?: string; model?: string } | null;
}): ModelSelection {
  const fallbackInstance =
    input.fallback && "instanceId" in input.fallback
      ? input.fallback.instanceId
      : input.fallback && "provider" in input.fallback
        ? input.fallback.provider
        : undefined;
  const fallbackModel = input.fallback?.model;

  const instanceId = input.instanceId?.trim() || fallbackInstance?.trim();
  const model = input.model?.trim() || fallbackModel?.trim();

  if (!instanceId || !model) {
    throw usageError(
      "thread create needs a model selection. Pass --instance and --model, or use a project with defaultModelSelection.",
    );
  }
  return { instanceId, model };
}

function requireNonEmpty(value: string, flag: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw usageError(`${flag} is required.`);
  }
  return trimmed;
}
