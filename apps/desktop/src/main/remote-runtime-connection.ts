import {
  HttpRuntimeTransport,
  type RemoteRuntimeWorkspaceChanges,
} from "@threadlight/client";
import type {
  JsonRpcId,
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

export interface RemoteRuntimeConnectionOptions {
  endpoint: string;
  token: string;
  projectId: string;
  send(message: JsonRpcOutgoing): void;
}

export class RemoteRuntimeConnection {
  private readonly transport: HttpRuntimeTransport;
  private unsubscribe?: () => void;
  private initialized = false;
  private initialization?: Promise<void>;
  private internalRequestId = 0;
  private readonly internalResponses = new Map<
    JsonRpcId,
    { resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly options: RemoteRuntimeConnectionOptions) {
    this.transport = new HttpRuntimeTransport({
      endpoint: options.endpoint,
      token: options.token,
      projectId: options.projectId,
    });
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.transport.onMessage((message) =>
      this.receive(message),
    );
  }

  send(message: JsonRpcRequest): void {
    void this.transport.send(message).catch((error) => {
      if (message.id === undefined) return;
      this.options.send({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32010,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    });
  }

  initialize(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (this.initialization) return this.initialization;
    this.start();
    const id = `threadlight:remote:initialize:${++this.internalRequestId}`;
    this.initialization = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.internalResponses.delete(id);
        this.initialization = undefined;
        reject(new Error("Remote runtime initialization timed out."));
      }, 10_000);
      this.internalResponses.set(id, { resolve, reject, timer });
      void this.transport
        .send({
          jsonrpc: "2.0",
          id,
          method: "initialize",
          params: { capabilities: { executionApprovals: true } },
        })
        .catch((error) => {
          clearTimeout(timer);
          this.internalResponses.delete(id);
          this.initialization = undefined;
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
    return this.initialization;
  }

  listWorkspace(path?: string) {
    return this.transport.workspaceList(path);
  }

  getWorkspaceFile(path: string) {
    return this.transport.workspaceFile(path);
  }

  downloadWorkspaceFile(path: string) {
    return this.transport.downloadWorkspaceFile(path);
  }

  getWorkspaceChanges(): Promise<RemoteRuntimeWorkspaceChanges> {
    return this.transport.workspaceChanges();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.transport.close();
    this.initialized = false;
    this.initialization = undefined;
    for (const pending of this.internalResponses.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Remote runtime connection stopped."));
    }
    this.internalResponses.clear();
  }

  private receive(message: JsonRpcOutgoing): void {
    if ("id" in message) {
      const pending = this.internalResponses.get(message.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.internalResponses.delete(message.id);
        this.initialization = undefined;
        if ("error" in message && message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          this.initialized = true;
          pending.resolve();
        }
        return;
      }
    }
    this.options.send(message);
  }
}
