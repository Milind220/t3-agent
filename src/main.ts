import { Command, CommanderError, InvalidArgumentError } from "commander";
import { stdin as defaultStdin } from "node:process";
import { INTERACTION_MODES, RUNTIME_MODES } from "./types.js";
import {
  runEnv,
  runStatus,
  runThreadCreate,
  runThreadGet,
  runThreads,
  runTurnInterrupt,
  runTurnStart,
} from "./commands.js";
import { resolveConfig, type EnvReader } from "./config.js";
import { AgentError, EXIT_OK, EXIT_USAGE, usageError } from "./errors.js";
import { T3HttpClient, type FetchLike } from "./http.js";
import { errorEnvelope, successEnvelope, writeJson } from "./output.js";
import { CLI_NAME, CLI_VERSION } from "./version.js";

export type CliIo = {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
  env: EnvReader;
  fetch: FetchLike;
};

type GlobalFlags = {
  url?: string;
  token?: string;
  wsUrl?: string;
  timeout?: string;
  json?: boolean;
};

type StoredAction = () => Promise<unknown>;

let activeClient: T3HttpClient | undefined;
let activeIo: CliIo | undefined;
let capturedGlobals: GlobalFlags = {};

export async function runCli(
  argv: string[],
  io: CliIo = {
    stdout: process.stdout,
    stderr: process.stderr,
    stdin: defaultStdin,
    env: process.env,
    fetch,
  },
): Promise<number> {
  activeClient = undefined;
  activeIo = io;
  capturedGlobals = {};
  const program = createProgram(io);

  try {
    await program.parseAsync(argv, { from: "user" });
    const action = program.getOptionValue("_action") as StoredAction | undefined;
    if (!action) {
      program.outputHelp();
      return EXIT_OK;
    }

    const globals: GlobalFlags = { ...program.opts<GlobalFlags>(), ...capturedGlobals };
    const config = resolveConfig(
      {
        url: globals.url,
        token: globals.token,
        wsUrl: globals.wsUrl,
        timeoutMs: parseOptionalTimeout(globals.timeout),
      },
      io.env,
    );
    const client = new T3HttpClient(config, io.fetch);
    activeClient = client;
    const data = await action();
    const t3 = await client.envelopeMeta().catch(() => undefined);
    writeJson(io.stdout, successEnvelope(data, t3));
    return EXIT_OK;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return EXIT_OK;
      }
      writeJson(io.stderr, errorEnvelope(usageError(stripCommanderPrefix(error.message))));
      return EXIT_USAGE;
    }
    if (error instanceof InvalidArgumentError) {
      writeJson(io.stderr, errorEnvelope(usageError(error.message)));
      return EXIT_USAGE;
    }
    writeJson(io.stderr, errorEnvelope(error));
    return error instanceof AgentError ? error.exitCode : EXIT_USAGE;
  } finally {
    activeClient = undefined;
    activeIo = undefined;
    capturedGlobals = {};
  }
}

function createProgram(io: CliIo): Command {
  const program = new Command();
  program.configureOutput({
    writeOut: (str) => {
      io.stdout.write(str);
    },
    writeErr: (str) => {
      io.stderr.write(str);
    },
  });
  addConnectionOptions(
    program
      .name(CLI_NAME)
      .description(
        "Headless HTTP client for a running T3 Code environment. JSON on stdout. Watch/WebSocket is not in this MVP.",
      )
      .version(CLI_VERSION)
      .showHelpAfterError(false)
      .helpCommand(false)
      .exitOverride(),
  );

  addConnectionOptions(
    program
      .command("env")
      .description("GET /.well-known/t3/environment and GET /api/auth/session"),
  ).action(function (this: Command) {
    captureGlobals(this);
    setAction(program, async () => runEnv(requireClient()));
  });

  addConnectionOptions(
    program
      .command("threads")
      .description("List thread shells from GET /api/orchestration/shell")
      .option("--project <id>", "Filter by project id")
      .option("--status <status>", "Filter by session.status or latestTurn.state"),
  ).action(function (this: Command, opts: { project?: string; status?: string }) {
    captureGlobals(this);
    setAction(program, async () =>
      runThreads(requireClient(), {
        projectId: opts.project,
        status: opts.status,
      }),
    );
  });

  const thread = program.command("thread").description("Read or create a thread");

  addConnectionOptions(
    thread
      .command("get")
      .argument("<id>", "Thread id")
      .option("--turns <n>", "Windowed snapshot turnLimit", parsePositiveInt)
      .option("--before-cursor <cursor>", "Windowed snapshot beforeCursor")
      .description("GET /api/orchestration/threads/:id"),
  ).action(function (this: Command, id: string, opts: { turns?: number; beforeCursor?: string }) {
    captureGlobals(this);
    setAction(program, async () =>
      runThreadGet(requireClient(), id, {
        ...(opts.turns !== undefined ? { turnLimit: opts.turns } : {}),
        beforeCursor: opts.beforeCursor,
      }),
    );
  });

  addConnectionOptions(
    thread
      .command("create")
      .requiredOption("--project <id>", "Project id")
      .requiredOption("--title <title>", "Thread title")
      .option("--instance <id>", "Provider instance id (else project default)")
      .option("--model <id>", "Model id (else project default)")
      .option(
        "--runtime-mode <mode>",
        `One of ${RUNTIME_MODES.join("|")} (always sent; default approval-required)`,
      )
      .option("--interaction-mode <mode>", `One of ${INTERACTION_MODES.join("|")}`)
      .option("--thread-id <id>", "Client-chosen thread UUID (default: generated)")
      .description("POST /api/orchestration/dispatch thread.create"),
  ).action(function (
    this: Command,
    opts: {
      project: string;
      title: string;
      instance?: string;
      model?: string;
      runtimeMode?: string;
      interactionMode?: string;
      threadId?: string;
    },
  ) {
    captureGlobals(this);
    setAction(program, async () =>
      runThreadCreate(requireClient(), {
        projectId: opts.project,
        title: opts.title,
        instanceId: opts.instance,
        model: opts.model,
        runtimeMode: opts.runtimeMode,
        interactionMode: opts.interactionMode,
        threadId: opts.threadId,
      }),
    );
  });

  const turn = program.command("turn").description("Start or interrupt a turn");

  addConnectionOptions(
    turn
      .command("start")
      .requiredOption("--thread <id>", "Thread id")
      .option("--text <text>", "User message (or pipe stdin)")
      .option(
        "--runtime-mode <mode>",
        `One of ${RUNTIME_MODES.join("|")} (always sent; default approval-required)`,
      )
      .option("--interaction-mode <mode>", `One of ${INTERACTION_MODES.join("|")}`)
      .option("--instance <id>", "Optional model instance override")
      .option("--model <id>", "Optional model override")
      .option("--title-seed <text>", "Optional title seed")
      .description("POST /api/orchestration/dispatch thread.turn.start"),
  ).action(function (
    this: Command,
    opts: {
      thread: string;
      text?: string;
      runtimeMode?: string;
      interactionMode?: string;
      instance?: string;
      model?: string;
      titleSeed?: string;
    },
  ) {
    captureGlobals(this);
    setAction(program, async () => {
      const text = await resolveTurnText(opts.text, requireIo());
      return runTurnStart(requireClient(), {
        threadId: opts.thread,
        text,
        runtimeMode: opts.runtimeMode,
        interactionMode: opts.interactionMode,
        instanceId: opts.instance,
        model: opts.model,
        titleSeed: opts.titleSeed,
      });
    });
  });

  addConnectionOptions(
    turn
      .command("interrupt")
      .requiredOption("--thread <id>", "Thread id")
      .description("POST /api/orchestration/dispatch thread.turn.interrupt"),
  ).action(function (this: Command, opts: { thread: string }) {
    captureGlobals(this);
    setAction(program, async () => runTurnInterrupt(requireClient(), opts.thread));
  });

  addConnectionOptions(
    program
      .command("status")
      .option("--thread <id>", "Compact status for one thread")
      .description("Compact thread status from the shell snapshot"),
  ).action(function (this: Command, opts: { thread?: string }) {
    captureGlobals(this);
    setAction(program, async () => runStatus(requireClient(), opts.thread));
  });

  return program;
}

function addConnectionOptions(command: Command): Command {
  return command
    .option("--url <origin>", "T3 HTTP origin (overrides T3_AGENT_URL)")
    .option("--token <bearer>", "Session bearer (overrides T3_AGENT_TOKEN)")
    .option("--ws-url <url>", "WebSocket URL for later watch (overrides T3_AGENT_WS_URL)")
    .option("--timeout <ms>", "HTTP timeout in milliseconds (default 30000)")
    .option("--json", "Always emit JSON (default; accepted for agent scripts)");
}

function captureGlobals(command: Command): void {
  capturedGlobals = command.optsWithGlobals() as GlobalFlags;
}

function setAction(program: Command, action: StoredAction): void {
  program.setOptionValue("_action", action);
}

function requireClient(): T3HttpClient {
  if (!activeClient) {
    throw usageError("Internal error: HTTP client was not initialized.");
  }
  return activeClient;
}

function requireIo(): CliIo {
  if (!activeIo) {
    throw usageError("Internal error: CLI I/O was not initialized.");
  }
  return activeIo;
}

function parseOptionalTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw usageError("--timeout must be a positive number of milliseconds.");
  }
  return parsed;
}

function parsePositiveInt(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("--turns must be an integer >= 1.");
  }
  return parsed;
}

async function resolveTurnText(flagText: string | undefined, io: CliIo): Promise<string> {
  if (flagText !== undefined) return flagText;
  const piped = await readStdin(io.stdin);
  if (piped.trim().length > 0) return piped;
  throw usageError("turn start requires --text or a message on stdin.");
}

async function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  if ("isTTY" in stream && stream.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function stripCommanderPrefix(message: string): string {
  return message.replace(/^error:\s*/i, "");
}
