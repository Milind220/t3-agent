export { runCli, type CliIo } from "./main.js";
export { T3HttpClient } from "./http.js";
export { resolveConfig, deriveWsUrl, type ResolvedConfig } from "./config.js";
export {
  buildThreadCreateCommand,
  buildTurnStartCommand,
  buildTurnInterruptCommand,
} from "./payloads.js";
export { AgentError } from "./errors.js";
export { CLI_NAME, CLI_VERSION, T3_CONTRACTS_REF } from "./version.js";
export type {
  ClientOrchestrationCommand,
  RuntimeMode,
  InteractionMode,
  ModelSelection,
} from "./types.js";
