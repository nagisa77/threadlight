import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { Socket } from "node:net";
import type { Duplex } from "node:stream";

import type {
  ComputerShareRuntime,
  ComputerShareState,
  ComputerShareTarget,
  ComputerUseAction,
  ComputerUseDriver,
} from "@threadlight/builtin-tools";
import type {
  DesktopComputerMethod,
  DesktopComputerResponse,
  JsonRpcId,
} from "@threadlight/protocol";
import type { ToolContext } from "@threadlight/agent-loop";

const DESKTOP_COMPUTER_RPC_FD = "THREADLIGHT_COMPUTER_RPC_FD";

export class DesktopComputerClient
  implements ComputerUseDriver, ComputerShareRuntime
{
  private readonly lines: ReadlineInterface;
  private readonly pending = new Map<
    JsonRpcId,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      cleanup(): void;
    }
  >();
  private nextId = 1;

  constructor(private readonly transport: Duplex) {
    this.lines = createInterface({ input: transport });
    this.lines.on("line", (line) => this.receive(line));
    transport.on("error", (error) => this.failAll(error));
    transport.on("close", () =>
      this.failAll(new Error("Desktop computer service disconnected")),
    );
  }

  async list(context: ToolContext): Promise<readonly ComputerShareTarget[]> {
    return this.request<ComputerShareTarget[]>(
      "computer/list",
      {},
      context.signal,
    );
  }

  async configure(
    options: {
      mode: "applications" | "windows" | "display";
      targetIds: readonly string[];
      pictureInPicture: boolean;
      inputMode: "virtual" | "system";
    },
    context: ToolContext,
  ): Promise<ComputerShareState> {
    return this.request<ComputerShareState>(
      "computer/configure",
      options,
      context.signal,
    );
  }

  async clear(context: ToolContext): Promise<ComputerShareState> {
    return this.request<ComputerShareState>(
      "computer/clear",
      {},
      context.signal,
    );
  }

  async execute(
    actions: readonly ComputerUseAction[],
    context: ToolContext,
  ): Promise<Uint8Array> {
    const result = await this.request<{ screenshot: string }>(
      "computer/execute",
      { actions },
      context.signal,
    );
    return Buffer.from(result.screenshot, "base64");
  }

  dispose(): void {
    this.lines.close();
    this.transport.destroy();
    this.failAll(new Error("Desktop computer service disposed"));
  }

  private request<Result>(
    method: DesktopComputerMethod,
    params: unknown,
    signal: AbortSignal,
  ): Promise<Result> {
    signal.throwIfAborted();
    const id = this.nextId++;
    return new Promise<Result>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        reject(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
      };
      const cleanup = () => signal.removeEventListener("abort", abort);
      this.pending.set(id, {
        resolve: (value) => resolve(value as Result),
        reject,
        cleanup,
      });
      signal.addEventListener("abort", abort, { once: true });
      this.transport.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
        (error) => {
          if (!error) return;
          const pending = this.pending.get(id);
          this.pending.delete(id);
          pending?.cleanup();
          pending?.reject(error);
        },
      );
    });
  }

  private receive(line: string): void {
    if (!line.trim()) return;
    let response: DesktopComputerResponse;
    try {
      response = JSON.parse(line) as DesktopComputerResponse;
    } catch {
      this.failAll(new Error("Desktop computer service returned invalid JSON"));
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    pending.cleanup();
    if (response.error) {
      pending.reject(new Error(response.error.message));
    } else {
      pending.resolve(response.result);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function createDesktopComputerClientFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): DesktopComputerClient | undefined {
  const rawFd = environment[DESKTOP_COMPUTER_RPC_FD];
  if (!rawFd) return;
  const fd = Number(rawFd);
  if (!Number.isInteger(fd) || fd < 3) {
    throw new Error(`${DESKTOP_COMPUTER_RPC_FD} must be a file descriptor`);
  }
  return new DesktopComputerClient(
    new Socket({ fd, readable: true, writable: true }),
  );
}
