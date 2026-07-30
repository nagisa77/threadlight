import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { Duplex } from "node:stream";

import type {
  DesktopConnectionRequest,
  DesktopComputerRequest,
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";
import {
  DESKTOP_COMPUTER_METHODS,
  DESKTOP_CONNECTION_METHODS,
} from "@threadlight/protocol";

const APP_SERVER_UNAVAILABLE = -32010;
const APP_SERVER_INITIALIZE_TIMEOUT_MS = 10_000;

export interface AppServerEntryOptions {
  appPath: string;
  isPackaged: boolean;
  override?: string;
}

export function resolveAppServerEntry({
  appPath,
  isPackaged,
  override,
}: AppServerEntryOptions): string {
  if (override) return override;
  return isPackaged
    ? resolve(
        appPath,
        "node_modules/@threadlight/app-server/dist/bin.js",
      )
    : resolve(appPath, "../../packages/app-server/dist/bin.js");
}

export interface AppServerProcessOptions {
  entry: string;
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  send(message: JsonRpcOutgoing): void;
  handleComputerRequest?(
    request: DesktopComputerRequest,
  ): Promise<unknown>;
  handleConnectionRequest?(
    request: DesktopConnectionRequest,
  ): Promise<unknown>;
}

export class AppServerProcess {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: ReadlineInterface;
  private computerLines?: ReadlineInterface;
  private computerPipe?: Duplex;
  private connectionLines?: ReadlineInterface;
  private connectionPipe?: Duplex;
  private readonly pending = new Set<JsonRpcId>();
  private readonly externalInitializeRequests = new Set<JsonRpcId>();
  private initialization?: {
    id: string;
    promise: Promise<void>;
    resolve(): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  };
  private initialized = false;
  private internalRequestId = 0;
  private environment: NodeJS.ProcessEnv;

  constructor(private readonly options: AppServerProcessOptions) {
    this.environment = options.environment ?? {};
  }

  start(): void {
    if (this.child) return;

    const child = spawn(process.execPath, [this.options.entry], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        ...this.environment,
        ELECTRON_RUN_AS_NODE: "1",
        THREADLIGHT_COMPUTER_RPC_FD: "3",
        THREADLIGHT_CONNECTION_RPC_FD: "4",
      },
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    const computerPipe = child.stdio[3] as Duplex | undefined;
    if (!computerPipe) {
      child.kill();
      throw new Error("Failed to create desktop computer RPC pipe");
    }
    this.computerPipe = computerPipe;
    this.computerLines = createInterface({ input: computerPipe });
    const connectionPipe = child.stdio[4] as Duplex | undefined;
    if (!connectionPipe) {
      child.kill();
      throw new Error("Failed to create desktop connection RPC pipe");
    }
    this.connectionPipe = connectionPipe;
    this.connectionLines = createInterface({ input: connectionPipe });

    this.lines.on("line", (line) => this.receive(line));
    this.computerLines.on("line", (line) => {
      void this.receiveComputer(line);
    });
    this.connectionLines.on("line", (line) => {
      void this.receiveConnection(line);
    });
    child.stderr.on("data", (data: Buffer) => {
      process.stderr.write(`[app-server] ${data.toString()}`);
    });
    child.on("error", (error) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.closeTransport();
      this.failAll(error.message);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.closeTransport();
      const reason = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
      this.failAll(`App server stopped with ${reason}`);
    });
  }

  send(message: JsonRpcRequest): void {
    const child = this.child;
    if (!child || child.stdin.destroyed) {
      this.replyUnavailable(message.id, "App server is not running");
      return;
    }

    if (message.id !== undefined) {
      this.pending.add(message.id);
      if (message.method === "initialize") {
        this.externalInitializeRequests.add(message.id);
      }
    }
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this.fail(message.id, error.message);
    });
  }

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initialization) return this.initialization.promise;
    this.start();
    const child = this.child;
    if (!child || child.stdin.destroyed) {
      return Promise.reject(new Error("App server is not running"));
    }

    const id = `threadlight:internal:initialize:${++this.internalRequestId}`;
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timer = setTimeout(() => {
      this.rejectInitialization(
        id,
        new Error("App server initialization timed out"),
      );
    }, APP_SERVER_INITIALIZE_TIMEOUT_MS);
    this.initialization = {
      id,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timer,
    };
    this.pending.add(id);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: { capabilities: { executionApprovals: true } },
      })}\n`,
      (error) => {
        if (error) this.rejectInitialization(id, error);
      },
    );
    return promise;
  }

  restart(environment: NodeJS.ProcessEnv): void {
    this.stop();
    this.environment = environment;
    this.start();
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    this.initialized = false;
    this.closeTransport();
    child?.stdin.end();
    child?.kill();
    this.failAll("App server stopped");
  }

  private receive(line: string): void {
    try {
      const message = JSON.parse(line) as JsonRpcOutgoing;
      if (
        "id" in message &&
        this.initialization?.id === message.id
      ) {
        const initialization = this.initialization;
        this.initialization = undefined;
        this.pending.delete(message.id);
        clearTimeout(initialization.timer);
        if ("error" in message && message.error) {
          initialization.reject(new Error(message.error.message));
        } else {
          this.initialized = true;
          initialization.resolve();
        }
        return;
      }
      if ("id" in message) {
        this.pending.delete(message.id);
        if (this.externalInitializeRequests.delete(message.id)) {
          this.initialized = !("error" in message && message.error);
        }
      }
      this.options.send(message);
    } catch (error) {
      process.stderr.write(`Invalid app-server message: ${String(error)}\n`);
    }
  }

  private closeTransport(): void {
    this.lines?.close();
    this.lines = undefined;
    this.computerLines?.close();
    this.computerLines = undefined;
    this.computerPipe?.destroy();
    this.computerPipe = undefined;
    this.connectionLines?.close();
    this.connectionLines = undefined;
    this.connectionPipe?.destroy();
    this.connectionPipe = undefined;
  }

  private async receiveComputer(line: string): Promise<void> {
    const pipe = this.computerPipe;
    if (!pipe || !line.trim()) return;

    let request: DesktopComputerRequest | undefined;
    try {
      const value = JSON.parse(line) as unknown;
      if (!isDesktopComputerRequest(value)) {
        throw new Error("Invalid desktop computer request");
      }
      request = value;
      if (!this.options.handleComputerRequest) {
        throw new Error("Desktop computer service is unavailable");
      }
      const result = await this.options.handleComputerRequest(request);
      if (pipe.destroyed) return;
      pipe.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
    } catch (error) {
      if (!request || pipe.destroyed) return;
      pipe.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32020,
            message: error instanceof Error ? error.message : String(error),
            ...toolErrorData(error),
          },
        })}\n`,
      );
    }
  }

  private async receiveConnection(line: string): Promise<void> {
    const pipe = this.connectionPipe;
    if (!pipe || !line.trim()) return;

    let request: DesktopConnectionRequest | undefined;
    try {
      const value = JSON.parse(line) as unknown;
      if (!isDesktopConnectionRequest(value)) {
        throw new Error("Invalid desktop connection request");
      }
      request = value;
      if (!this.options.handleConnectionRequest) {
        throw new Error("Desktop connection service is unavailable");
      }
      const result = await this.options.handleConnectionRequest(request);
      if (pipe.destroyed) return;
      pipe.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
    } catch (error) {
      if (!request || pipe.destroyed) return;
      pipe.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          error: {
            code: -32021,
            message: error instanceof Error ? error.message : String(error),
          },
        })}\n`,
      );
    }
  }

  private fail(id: JsonRpcId | undefined, message: string): void {
    if (id === undefined || !this.pending.delete(id)) return;
    this.externalInitializeRequests.delete(id);
    this.replyUnavailable(id, message);
  }

  private failAll(message: string): void {
    const initialization = this.initialization;
    if (initialization) {
      this.initialization = undefined;
      this.pending.delete(initialization.id);
      clearTimeout(initialization.timer);
      initialization.reject(new Error(message));
    }
    this.initialized = false;
    for (const id of this.pending) this.replyUnavailable(id, message);
    this.pending.clear();
    this.externalInitializeRequests.clear();
  }

  private rejectInitialization(id: string, error: Error): void {
    const initialization = this.initialization;
    if (!initialization || initialization.id !== id) return;
    this.initialization = undefined;
    this.pending.delete(id);
    clearTimeout(initialization.timer);
    initialization.reject(error);
  }

  private replyUnavailable(id: JsonRpcId | undefined, message: string): void {
    if (id === undefined) return;
    this.options.send({
      jsonrpc: "2.0",
      id,
      error: { code: APP_SERVER_UNAVAILABLE, message },
    });
  }
}

function toolErrorData(error: unknown): { data: unknown } | undefined {
  if (!error || typeof error !== "object" || Array.isArray(error)) return;
  const value = (error as { toolError?: unknown }).toolError;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  return { data: value };
}

function isDesktopComputerRequest(
  value: unknown,
): value is DesktopComputerRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    request.jsonrpc === "2.0" &&
    (typeof request.id === "string" || typeof request.id === "number") &&
    typeof request.method === "string" &&
    DESKTOP_COMPUTER_METHODS.includes(
      request.method as (typeof DESKTOP_COMPUTER_METHODS)[number],
    )
  );
}

function isDesktopConnectionRequest(
  value: unknown,
): value is DesktopConnectionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  return (
    request.jsonrpc === "2.0" &&
    (typeof request.id === "string" || typeof request.id === "number") &&
    typeof request.method === "string" &&
    DESKTOP_CONNECTION_METHODS.includes(
      request.method as (typeof DESKTOP_CONNECTION_METHODS)[number],
    )
  );
}
