import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import {
  createInterface,
  type Interface as ReadlineInterface,
} from "node:readline";
import type { Duplex } from "node:stream";

import {
  DESKTOP_CONNECTION_METHODS,
  type DesktopConnectionRequest,
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

export interface RuntimePeer {
  start(): Promise<void>;
  send(message: JsonRpcRequest): void | Promise<void>;
  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void;
  onExit?(listener: (error: Error) => void): () => void;
  stop(): Promise<void>;
}

export interface JsonLineRuntimePeerOptions {
  entry: string;
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  onLog?: (message: string) => void;
  handleConnectionRequest?(
    request: DesktopConnectionRequest,
  ): Promise<unknown>;
}

export class JsonLineRuntimePeer implements RuntimePeer {
  private child?: ChildProcessWithoutNullStreams;
  private connectionLines?: ReadlineInterface;
  private connectionPipe?: Duplex;
  private readonly listeners = new Set<(message: JsonRpcOutgoing) => void>();
  private readonly exitListeners = new Set<(error: Error) => void>();
  private exitError?: Error;

  constructor(private readonly options: JsonLineRuntimePeerOptions) {}

  async start(): Promise<void> {
    if (this.child) return;
    this.exitError = undefined;

    const environment = workspaceRuntimeEnvironment(this.options.cwd, {
      ...process.env,
      ...this.options.environment,
    });
    const child = spawn(process.execPath, [this.options.entry], {
      cwd: this.options.cwd,
      env: {
        ...environment,
        THREADLIGHT_COMPUTER_USE: "0",
        THREADLIGHT_PROJECT_ROOT:
          this.options.environment?.THREADLIGHT_PROJECT_ROOT ??
          this.options.cwd,
      },
      stdio: this.options.handleConnectionRequest
        ? ["pipe", "pipe", "pipe", "pipe"]
        : ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    if (this.options.handleConnectionRequest) {
      const connectionPipe = child.stdio[3] as Duplex | undefined;
      if (!connectionPipe) {
        child.kill();
        this.child = undefined;
        throw new Error("Failed to create Host connection RPC pipe");
      }
      this.connectionPipe = connectionPipe;
      this.connectionLines = createInterface({ input: connectionPipe });
      this.connectionLines.on("line", (line) => {
        void this.receiveConnection(line);
      });
    }

    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const message = JSON.parse(line) as JsonRpcOutgoing;
        for (const listener of this.listeners) listener(message);
      } catch (error) {
        this.options.onLog?.(
          `Invalid app-server output: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    const stderr = createInterface({ input: child.stderr });
    stderr.on("line", (line) => this.options.onLog?.(line));

    await new Promise<void>((resolve, reject) => {
      const onSpawn = () => {
        child.off("error", onError);
        resolve();
      };
      const onError = (error: Error) => {
        child.off("spawn", onSpawn);
        this.child = undefined;
        reject(error);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
    });

    child.once("exit", (code, signal) => {
      this.handleExit(
        child,
        new Error(
          signal
            ? `Remote runtime app-server exited from ${signal}.`
            : `Remote runtime app-server exited with code ${code ?? "unknown"}.`,
        ),
      );
    });
    child.once("error", (error) => this.handleExit(child, error));
    child.stdin.once("error", (error) => this.handleExit(child, error));
  }

  send(message: JsonRpcRequest): void {
    if (!this.child || this.child.killed) {
      throw this.exitError ??
        new Error("Remote runtime app-server is not running.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onExit(listener: (error: Error) => void): () => void {
    this.exitListeners.add(listener);
    if (this.exitError) {
      queueMicrotask(() => {
        if (this.exitListeners.has(listener) && this.exitError) {
          listener(this.exitError);
        }
      });
    }
    return () => this.exitListeners.delete(listener);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    this.closeConnectionTransport();
    if (!child || child.killed) return;

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill("SIGTERM");
    });
  }

  private handleExit(
    child: ChildProcessWithoutNullStreams,
    error: Error,
  ): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.closeConnectionTransport();
    this.exitError = error;
    for (const listener of this.exitListeners) listener(error);
  }

  private async receiveConnection(line: string): Promise<void> {
    const pipe = this.connectionPipe;
    if (!pipe || !line.trim()) return;
    let request: DesktopConnectionRequest | undefined;
    try {
      const value = JSON.parse(line) as unknown;
      if (!isDesktopConnectionRequest(value)) {
        throw new Error("Invalid Host connection request");
      }
      request = value;
      const result = await this.options.handleConnectionRequest?.(request);
      if (!pipe.destroyed) {
        pipe.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result,
          })}\n`,
        );
      }
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

  private closeConnectionTransport(): void {
    this.connectionLines?.close();
    this.connectionLines = undefined;
    this.connectionPipe?.destroy();
    this.connectionPipe = undefined;
  }
}

export function workspaceRuntimeEnvironment(
  workspacePath: string,
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const virtualEnvironmentBin =
    process.platform === "win32" ? "Scripts" : "bin";
  const candidates = [
    join(workspacePath, ".venv", virtualEnvironmentBin),
    join(workspacePath, "venv", virtualEnvironmentBin),
    join(workspacePath, "node_modules", ".bin"),
  ].filter((path) => existsSync(path));
  if (candidates.length === 0) return { ...environment };
  return {
    ...environment,
    PATH: [...candidates, environment.PATH].filter(Boolean).join(delimiter),
  };
}

function isDesktopConnectionRequest(
  value: unknown,
): value is DesktopConnectionRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const request = value as Record<string, unknown>;
  return (
    request.jsonrpc === "2.0" &&
    (typeof request.id === "string" ||
      typeof request.id === "number" ||
      request.id === null) &&
    typeof request.method === "string" &&
    DESKTOP_CONNECTION_METHODS.includes(
      request.method as (typeof DESKTOP_CONNECTION_METHODS)[number],
    )
  );
}
