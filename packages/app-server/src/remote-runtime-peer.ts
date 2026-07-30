import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

export interface RuntimePeer {
  start(): Promise<void>;
  send(message: JsonRpcRequest): void | Promise<void>;
  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void;
  stop(): Promise<void>;
}

export interface JsonLineRuntimePeerOptions {
  entry: string;
  cwd: string;
  environment?: NodeJS.ProcessEnv;
  onLog?: (message: string) => void;
}

export class JsonLineRuntimePeer implements RuntimePeer {
  private child?: ChildProcessWithoutNullStreams;
  private readonly listeners = new Set<(message: JsonRpcOutgoing) => void>();

  constructor(private readonly options: JsonLineRuntimePeerOptions) {}

  async start(): Promise<void> {
    if (this.child) return;

    const child = spawn(process.execPath, [this.options.entry], {
      cwd: this.options.cwd,
      env: {
        ...process.env,
        ...this.options.environment,
        THREADLIGHT_COMPUTER_USE: "0",
        THREADLIGHT_PROJECT_ROOT:
          this.options.environment?.THREADLIGHT_PROJECT_ROOT ??
          this.options.cwd,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;

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
  }

  send(message: JsonRpcRequest): void {
    if (!this.child || this.child.killed) {
      throw new Error("Remote runtime app-server is not running.");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
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
}
