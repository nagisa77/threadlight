import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { Duplex } from "node:stream";

import type {
  DesktopComputerRequest,
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";
import { DESKTOP_COMPUTER_METHODS } from "@threadlight/protocol";

const APP_SERVER_UNAVAILABLE = -32010;

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
}

export class AppServerProcess {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: ReadlineInterface;
  private computerLines?: ReadlineInterface;
  private computerPipe?: Duplex;
  private readonly pending = new Set<JsonRpcId>();
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
      },
      stdio: ["pipe", "pipe", "pipe", "pipe"],
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

    this.lines.on("line", (line) => this.receive(line));
    this.computerLines.on("line", (line) => {
      void this.receiveComputer(line);
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

    if (message.id !== undefined) this.pending.add(message.id);
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) this.fail(message.id, error.message);
    });
  }

  restart(environment: NodeJS.ProcessEnv): void {
    this.stop();
    this.environment = environment;
    this.start();
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    this.closeTransport();
    child?.stdin.end();
    child?.kill();
    this.failAll("App server stopped");
  }

  private receive(line: string): void {
    try {
      const message = JSON.parse(line) as JsonRpcOutgoing;
      if ("id" in message) this.pending.delete(message.id);
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

  private fail(id: JsonRpcId | undefined, message: string): void {
    if (id === undefined || !this.pending.delete(id)) return;
    this.replyUnavailable(id, message);
  }

  private failAll(message: string): void {
    for (const id of this.pending) this.replyUnavailable(id, message);
    this.pending.clear();
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
