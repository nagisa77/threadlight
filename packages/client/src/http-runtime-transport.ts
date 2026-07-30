import type {
  JsonRpcOutgoing,
  JsonRpcRequest,
} from "@threadlight/protocol";

import type { ClientTransport } from "./client.js";

export interface HttpRuntimeTransportOptions {
  endpoint: string;
  token: string;
  projectId?: string;
  fetch?: typeof globalThis.fetch;
  reconnectDelayMs?: number;
  onConnectionChange?: (connected: boolean) => void;
}

export class HttpRuntimeTransport implements ClientTransport {
  private readonly endpoint: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly listeners = new Set<(message: JsonRpcOutgoing) => void>();
  private eventAbort?: AbortController;
  private closed = false;
  private connected = false;

  constructor(private readonly options: HttpRuntimeTransportOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    if (!options.token.trim()) throw new Error("Remote runtime token is required.");
  }

  async send(message: JsonRpcRequest): Promise<void> {
    const response = await this.fetcher(this.url("/rpc"), {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(message),
    });
    const payload = await response.json() as JsonRpcOutgoing | { error?: string };
    if (!response.ok) {
      throw new Error(
        "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Remote runtime request failed (${response.status}).`,
      );
    }
    this.emit(payload as JsonRpcOutgoing);
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    this.listeners.add(listener);
    this.ensureEventStream();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopEventStream();
    };
  }

  async workspaceList(path = ""): Promise<RemoteRuntimeWorkspaceEntry[]> {
    return this.getJson(
      `/workspace/list?path=${encodeURIComponent(path)}`,
    );
  }

  async workspaceFile(path: string): Promise<RemoteRuntimeWorkspaceFile> {
    return this.getJson(
      `/workspace/file?path=${encodeURIComponent(path)}`,
    );
  }

  async workspaceChanges(): Promise<RemoteRuntimeWorkspaceChanges> {
    return this.getJson("/workspace/changes");
  }

  close(): void {
    this.closed = true;
    this.stopEventStream();
    this.listeners.clear();
  }

  private ensureEventStream(): void {
    if (this.closed || this.eventAbort || this.listeners.size === 0) return;
    const abort = new AbortController();
    this.eventAbort = abort;
    void this.consumeEvents(abort);
  }

  private async consumeEvents(abort: AbortController): Promise<void> {
    try {
      const response = await this.fetcher(this.url("/events"), {
        headers: this.headers(),
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        throw new Error(`Remote runtime event stream failed (${response.status}).`);
      }
      this.setConnected(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!this.closed && !abort.signal.aborted) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          this.emit(JSON.parse(line) as JsonRpcOutgoing);
        }
      }
    } catch (error) {
      if (!abort.signal.aborted) this.setConnected(false);
    } finally {
      if (this.eventAbort === abort) this.eventAbort = undefined;
      if (!this.closed && !abort.signal.aborted && this.listeners.size > 0) {
        setTimeout(
          () => this.ensureEventStream(),
          this.options.reconnectDelayMs ?? 1_000,
        );
      }
    }
  }

  private stopEventStream(): void {
    this.eventAbort?.abort();
    this.eventAbort = undefined;
    this.setConnected(false);
  }

  private setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;
    this.options.onConnectionChange?.(connected);
  }

  private emit(message: JsonRpcOutgoing): void {
    for (const listener of this.listeners) listener(message);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.options.token}`,
      "X-Threadlight-Host-Endpoint": this.endpoint,
      ...extra,
    };
  }

  private async getJson<Result>(path: string): Promise<Result> {
    const response = await this.fetcher(this.url(path), {
      headers: this.headers(),
    });
    const payload = await response.json() as Result | { error?: string };
    if (!response.ok) {
      throw new Error(
        typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
          ? payload.error
          : `Remote runtime request failed (${response.status}).`,
      );
    }
    return payload as Result;
  }

  private url(path: string): string {
    const prefix = this.options.projectId
      ? `/v1/projects/${encodeURIComponent(this.options.projectId)}/runtime`
      : "/v1";
    return `${this.endpoint}${prefix}${path}`;
  }
}

export interface RemoteRuntimeWorkspaceEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
}

export interface RemoteRuntimeWorkspaceFile {
  path: string;
  content: string;
  binary: boolean;
  size: number;
}

export interface RemoteRuntimeWorkspaceChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked";
  additions: number;
  deletions: number;
  binary: boolean;
  oldText?: string;
  newText?: string;
}

export interface RemoteRuntimeWorkspaceChanges {
  revision: string;
  files: RemoteRuntimeWorkspaceChangedFile[];
}

function normalizeEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Remote runtime endpoint must use http or https.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
