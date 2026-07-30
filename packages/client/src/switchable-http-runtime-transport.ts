import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

import type { ClientTransport } from "./client.js";
import {
  HttpRuntimeTransport,
  type HttpRuntimeTransportOptions,
} from "./http-runtime-transport.js";

export interface SwitchableHttpRuntimeTransportOptions {
  endpoint: string;
  token: string;
  fetch?: typeof globalThis.fetch;
  reconnectDelayMs?: number;
  onConnectionChange?: (
    connected: boolean,
    projectId: string | undefined,
  ) => void;
}

/**
 * Keeps one stable client transport while routing requests to the active
 * project runtime on a remote Host.
 */
export class SwitchableHttpRuntimeTransport implements ClientTransport {
  private readonly listeners = new Set<
    (message: JsonRpcOutgoing) => void
  >();
  private transport?: HttpRuntimeTransport;
  private unsubscribe?: () => void;
  private activeProjectId?: string;
  private closed = false;

  constructor(
    private readonly options: SwitchableHttpRuntimeTransportOptions,
  ) {}

  get projectId(): string | undefined {
    return this.activeProjectId;
  }

  activateProject(projectId: string): void {
    const value = projectId.trim();
    if (!value) throw new Error("A remote project id is required.");
    if (this.closed) {
      throw new Error("The remote Host transport is closed.");
    }
    if (this.transport && this.activeProjectId === value) return;

    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.transport?.close();
    this.activeProjectId = value;
    this.transport = new HttpRuntimeTransport(
      this.runtimeOptions(value),
    );
    this.subscribeTransport();
  }

  send(message: JsonRpcRequest): void | Promise<void> {
    return this.requireTransport().send(message);
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    if (this.closed) {
      throw new Error("The remote Host transport is closed.");
    }
    this.listeners.add(listener);
    this.subscribeTransport();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.unsubscribe?.();
        this.unsubscribe = undefined;
      }
    };
  }

  workspaceList(path = "") {
    return this.requireTransport().workspaceList(path);
  }

  workspaceFile(path: string) {
    return this.requireTransport().workspaceFile(path);
  }

  workspaceChanges() {
    return this.requireTransport().workspaceChanges();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.transport?.close();
    this.transport = undefined;
    this.activeProjectId = undefined;
    this.listeners.clear();
  }

  private subscribeTransport(): void {
    if (
      this.unsubscribe ||
      !this.transport ||
      this.listeners.size === 0
    ) {
      return;
    }
    this.unsubscribe = this.transport.onMessage((message) => {
      for (const listener of this.listeners) listener(message);
    });
  }

  private requireTransport(): HttpRuntimeTransport {
    if (!this.transport || !this.activeProjectId) {
      throw new Error("Select a remote project before using its runtime.");
    }
    return this.transport;
  }

  private runtimeOptions(projectId: string): HttpRuntimeTransportOptions {
    return {
      endpoint: this.options.endpoint,
      token: this.options.token,
      projectId,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      ...(this.options.reconnectDelayMs === undefined
        ? {}
        : { reconnectDelayMs: this.options.reconnectDelayMs }),
      onConnectionChange: (connected) =>
        this.options.onConnectionChange?.(connected, projectId),
    };
  }
}
