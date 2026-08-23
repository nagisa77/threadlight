export {
  ClientClosedError,
  RpcResponseError,
  ThreadlightClient,
} from "./client.js";
export type { ClientTransport, ThreadlightClientOptions } from "./client.js";
export {
  HttpRuntimeTransport,
  type HttpRuntimeTransportOptions,
  type RemoteRuntimeWorkspaceChangedFile,
  type RemoteRuntimeWorkspaceChanges,
  type RemoteRuntimeWorkspaceEntry,
  type RemoteRuntimeWorkspaceFile,
} from "./http-runtime-transport.js";
export {
  HttpHostClient,
  type HostAttachmentUpload,
  type HostAudioTranscriptionRequest,
  type HttpHostClientOptions,
} from "./http-host-client.js";
export {
  SwitchableHttpRuntimeTransport,
  type SwitchableHttpRuntimeTransportOptions,
} from "./switchable-http-runtime-transport.js";
export {
  BrowserTerminalClient,
  browserTerminalProtocols,
  type BrowserSocket,
  type BrowserSocketEvent,
  type BrowserTerminalClientOptions,
} from "./browser-terminal-client.js";
export { createBrowserUuid } from "./browser-uuid.js";
export {
  parseThreadlightCli,
  threadlightCliUsage,
  ThreadlightCliUsageError,
} from "./command-cli-options.js";
export type {
  ThreadlightCommand,
  ThreadlightProjectsCommand,
  ThreadlightRunCommand,
} from "./command-cli-options.js";
export { runRemoteTask, selectHostProject } from "./remote-task.js";
export type {
  RemoteTaskApproval,
  RemoteTaskResult,
  RemoteTaskStatus,
  RunRemoteTaskOptions,
} from "./remote-task.js";
