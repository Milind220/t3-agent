/** T3 RuntimeMode. Server default is full-access; this CLI always sends an explicit value. */
export const RUNTIME_MODES = [
  "approval-required",
  "auto-accept-edits",
  "auto",
  "full-access",
] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export const INTERACTION_MODES = ["default", "plan"] as const;
export type InteractionMode = (typeof INTERACTION_MODES)[number];

/** Safer CLI default than T3's server default (`full-access`). */
export const DEFAULT_RUNTIME_MODE: RuntimeMode = "approval-required";
export const DEFAULT_INTERACTION_MODE: InteractionMode = "default";

export type ModelSelection = {
  instanceId: string;
  model: string;
  options?: Record<string, unknown>;
};

export type ExecutionEnvironmentDescriptor = {
  environmentId: string;
  label: string;
  platform: {
    os: string;
    arch: string;
    machine?: string;
  };
  serverVersion: string;
  capabilities: Record<string, unknown>;
};

export type AuthSessionState = {
  authenticated: boolean;
  auth?: {
    policy?: string;
    bootstrapMethods?: string[];
    sessionMethods?: string[];
    sessionCookieName?: string;
  };
  scopes?: string[];
  sessionMethod?: string;
  expiresAt?: string;
};

export type OrchestrationProjectShell = {
  id: string;
  title: string;
  workspaceRoot: string;
  defaultModelSelection?: ModelSelection | null;
  [key: string]: unknown;
};

export type OrchestrationSession = {
  threadId?: string;
  status?: string;
  providerName?: string | null;
  providerInstanceId?: string;
  runtimeMode?: string;
  activeTurnId?: string | null;
  lastError?: string | null;
  updatedAt?: string;
};

export type OrchestrationLatestTurn = {
  turnId?: string;
  state?: string;
  requestedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  [key: string]: unknown;
};

export type OrchestrationThreadShell = {
  id: string;
  projectId: string;
  title: string;
  modelSelection?: ModelSelection | { provider?: string; model?: string };
  runtimeMode?: string;
  interactionMode?: string;
  session?: OrchestrationSession | null;
  latestTurn?: OrchestrationLatestTurn | null;
  hasPendingApprovals?: boolean;
  hasPendingUserInput?: boolean;
  hasActionableProposedPlan?: boolean;
  backgroundLiveness?: string | null;
  [key: string]: unknown;
};

export type OrchestrationShellSnapshot = {
  snapshotSequence: number;
  projects: OrchestrationProjectShell[];
  threads: OrchestrationThreadShell[];
  updatedAt: string;
};

export type OrchestrationThreadDetailSnapshot = {
  snapshotSequence: number;
  thread: Record<string, unknown> & { id?: string };
  page?: Record<string, unknown>;
};

export type DispatchResult = {
  sequence: number;
};

export type T3EnvelopeMeta = {
  serverVersion: string;
  environmentId: string;
  capabilities: Record<string, unknown>;
};

export type ThreadCreateCommand = {
  type: "thread.create";
  commandId: string;
  threadId: string;
  projectId: string;
  title: string;
  modelSelection: ModelSelection;
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  branch: string | null;
  worktreePath: string | null;
  createdAt: string;
};

export type ThreadTurnStartCommand = {
  type: "thread.turn.start";
  commandId: string;
  threadId: string;
  message: {
    messageId: string;
    role: "user";
    text: string;
    attachments: [];
  };
  runtimeMode: RuntimeMode;
  interactionMode: InteractionMode;
  createdAt: string;
  modelSelection?: ModelSelection;
  titleSeed?: string;
};

export type ThreadTurnInterruptCommand = {
  type: "thread.turn.interrupt";
  commandId: string;
  threadId: string;
  createdAt: string;
};

export type ClientOrchestrationCommand =
  | ThreadCreateCommand
  | ThreadTurnStartCommand
  | ThreadTurnInterruptCommand;

export type T3ErrorBody = {
  _tag?: string;
  code?: string;
  reason?: string;
  message?: string;
  traceId?: string;
  requiredScope?: string;
  dpopFailureReason?: string;
  [key: string]: unknown;
};
