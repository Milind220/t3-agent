import { usageError } from "./errors.js";
import type { T3HttpClient } from "./http.js";
import {
  buildThreadCreateCommand,
  buildTurnInterruptCommand,
  buildTurnStartCommand,
  resolveModelSelection,
} from "./payloads.js";
import type {
  AuthSessionState,
  ExecutionEnvironmentDescriptor,
  OrchestrationProjectShell,
  OrchestrationShellSnapshot,
  OrchestrationThreadShell,
} from "./types.js";

export async function runEnv(client: T3HttpClient): Promise<{
  environment: ExecutionEnvironmentDescriptor;
  session: AuthSessionState;
  wsUrl: string;
}> {
  const [environment, session] = await Promise.all([
    client.getEnvironment(),
    client.getSession(),
  ]);
  return {
    environment,
    session,
    wsUrl: client.config.wsUrl,
  };
}

export async function runThreads(
  client: T3HttpClient,
  filters: { projectId?: string; status?: string },
): Promise<{
  snapshotSequence: number;
  updatedAt: string;
  projects: OrchestrationProjectShell[];
  threads: OrchestrationThreadShell[];
}> {
  const shell = await client.getShell();
  let threads = shell.threads ?? [];
  if (filters.projectId) {
    threads = threads.filter((thread) => thread.projectId === filters.projectId);
  }
  if (filters.status) {
    const wanted = filters.status.toLowerCase();
    threads = threads.filter((thread) => threadMatchesStatus(thread, wanted));
  }
  return {
    snapshotSequence: shell.snapshotSequence,
    updatedAt: shell.updatedAt,
    projects: shell.projects ?? [],
    threads,
  };
}

export async function runThreadGet(
  client: T3HttpClient,
  threadId: string,
  query: { turnLimit?: number; beforeCursor?: string },
) {
  if (threadId.trim().length === 0) {
    throw usageError("thread get requires a thread id.");
  }
  return client.getThread(threadId.trim(), query);
}

export async function runThreadCreate(
  client: T3HttpClient,
  input: {
    projectId: string;
    title: string;
    instanceId?: string;
    model?: string;
    runtimeMode?: string;
    interactionMode?: string;
    threadId?: string;
  },
) {
  const modelSelection = await resolveCreateModelSelection(client, input);
  const command = buildThreadCreateCommand({
    projectId: input.projectId,
    title: input.title,
    modelSelection,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    threadId: input.threadId,
  });
  const result = await client.dispatch(command);
  return { command, result };
}

export async function runTurnStart(
  client: T3HttpClient,
  input: {
    threadId: string;
    text: string;
    runtimeMode?: string;
    interactionMode?: string;
    instanceId?: string;
    model?: string;
    titleSeed?: string;
  },
) {
  const modelSelection =
    input.instanceId || input.model
      ? resolveModelSelection({
          instanceId: input.instanceId,
          model: input.model,
        })
      : undefined;
  const command = buildTurnStartCommand({
    threadId: input.threadId,
    text: input.text,
    runtimeMode: input.runtimeMode,
    interactionMode: input.interactionMode,
    ...(modelSelection !== undefined ? { modelSelection } : {}),
    titleSeed: input.titleSeed,
  });
  const result = await client.dispatch(command);
  return { command, result };
}

export async function runTurnInterrupt(client: T3HttpClient, threadId: string) {
  const command = buildTurnInterruptCommand({ threadId });
  const result = await client.dispatch(command);
  return { command, result };
}

export async function runStatus(client: T3HttpClient, threadId?: string) {
  const shell = await client.getShell();
  const compact = (thread: OrchestrationThreadShell) => ({
    id: thread.id,
    projectId: thread.projectId,
    title: thread.title,
    runtimeMode: thread.runtimeMode ?? thread.session?.runtimeMode ?? null,
    sessionStatus: thread.session?.status ?? null,
    lastError: thread.session?.lastError ?? null,
    activeTurnId: thread.session?.activeTurnId ?? null,
    latestTurnState: thread.latestTurn?.state ?? null,
    hasPendingApprovals: thread.hasPendingApprovals ?? false,
    hasPendingUserInput: thread.hasPendingUserInput ?? false,
    hasActionableProposedPlan: thread.hasActionableProposedPlan ?? false,
    backgroundLiveness: thread.backgroundLiveness ?? null,
  });

  if (threadId) {
    const thread = (shell.threads ?? []).find((item) => item.id === threadId);
    if (!thread) {
      throw usageError(`Thread ${threadId} was not in the shell snapshot.`);
    }
    return {
      snapshotSequence: shell.snapshotSequence,
      thread: compact(thread),
    };
  }

  return {
    snapshotSequence: shell.snapshotSequence,
    updatedAt: shell.updatedAt,
    threads: (shell.threads ?? []).map(compact),
  };
}

async function resolveCreateModelSelection(
  client: T3HttpClient,
  input: { projectId: string; instanceId?: string; model?: string },
) {
  if (input.instanceId && input.model) {
    return resolveModelSelection({
      instanceId: input.instanceId,
      model: input.model,
    });
  }

  const shell = await client.getShell();
  const project = findProject(shell, input.projectId);
  return resolveModelSelection({
    instanceId: input.instanceId,
    model: input.model,
    fallback: project?.defaultModelSelection ?? null,
  });
}

function findProject(
  shell: OrchestrationShellSnapshot,
  projectId: string,
): OrchestrationProjectShell | undefined {
  return (shell.projects ?? []).find((project) => project.id === projectId);
}

function threadMatchesStatus(thread: OrchestrationThreadShell, wanted: string): boolean {
  const sessionStatus = thread.session?.status?.toLowerCase();
  const turnState = thread.latestTurn?.state?.toLowerCase();
  return sessionStatus === wanted || turnState === wanted;
}
