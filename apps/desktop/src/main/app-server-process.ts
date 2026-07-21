import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";

import type {
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

const APP_SERVER_UNAVAILABLE = -32010;

export interface AppServerProcessOptions {
  entry: string;
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  send(message: JsonRpcOutgoing): void;
}

export class AppServerProcess {
  private child?: ChildProcessWithoutNullStreams;
  private lines?: ReadlineInterface;
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
      },
      stdio: "pipe",
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });

    this.lines.on("line", (line) => this.receive(line));
    child.stderr.on("data", (data: Buffer) => {
      process.stderr.write(`[app-server] ${data.toString()}`);
    });
    child.on("error", (error) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.failAll(error.message);
    });
    child.on("exit", (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
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
    this.lines?.close();
    this.lines = undefined;
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
