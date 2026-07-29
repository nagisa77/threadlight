import type {
  AttachmentData,
  JsonRpcId,
  JsonRpcNotification,
  JsonRpcOutgoing,
  JsonRpcRequest,
  MethodParams,
  MethodResult,
  ThreadlightMethod,
  ThreadlightNotificationMap,
  ThreadlightNotificationMethod,
  SuggestionLanguage,
  TurnMode,
} from "@threadlight/protocol";

export interface ClientTransport {
  send(message: JsonRpcRequest): void | Promise<void>;
  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void;
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

export class RpcResponseError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "RpcResponseError";
  }
}

export class ClientClosedError extends Error {
  constructor(message = "Threadlight client is closed") {
    super(message);
    this.name = "ClientClosedError";
  }
}

export class ThreadlightClient {
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly listeners = new Set<
    (notification: JsonRpcNotification) => void
  >();
  private readonly unsubscribeTransport: () => void;
  private nextId = 1;
  private closed = false;

  constructor(private readonly transport: ClientTransport) {
    this.unsubscribeTransport = transport.onMessage((message) => {
      this.handleMessage(message);
    });
  }

  request<Method extends ThreadlightMethod>(
    method: Method,
    ...[params]: MethodParams<Method> extends undefined
      ? [params?: undefined]
      : [params: MethodParams<Method>]
  ): Promise<MethodResult<Method>> {
    if (this.closed) return Promise.reject(new ClientClosedError());

    const id = this.nextId++;
    const message: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    return new Promise<MethodResult<Method>>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as MethodResult<Method>),
        reject,
      });

      try {
        void Promise.resolve(this.transport.send(message)).catch((error) => {
          this.rejectRequest(id, error);
        });
      } catch (error) {
        this.rejectRequest(id, error);
      }
    });
  }

  initialize() {
    return this.request("initialize");
  }

  startThread() {
    return this.request("thread/start");
  }

  resumeThread(threadId: string) {
    return this.request("thread/resume", { threadId });
  }

  deleteThread(threadId: string) {
    return this.request("thread/delete", { threadId });
  }

  listCapabilities(threadId: string) {
    return this.request("capability/list", { threadId });
  }

  connectorStatus(threadId: string, capabilityId: string) {
    return this.request("connector/status", { threadId, capabilityId });
  }

  configureConnector(
    threadId: string,
    capabilityId: string,
    clientId: string,
    clientSecret: string,
  ) {
    return this.request("connector/configure", {
      threadId,
      capabilityId,
      clientId,
      clientSecret,
    });
  }

  authorizeConnector(threadId: string, capabilityId: string) {
    return this.request("connector/authorize", {
      threadId,
      capabilityId,
    });
  }

  disconnectConnector(threadId: string, capabilityId: string) {
    return this.request("connector/disconnect", {
      threadId,
      capabilityId,
    });
  }

  suggestQuestions(threadId: string, language: SuggestionLanguage) {
    return this.request("thread/suggestions", { threadId, language });
  }

  startTurn(
    threadId: string,
    input: string,
    attachments: readonly AttachmentData[] = [],
    mode: TurnMode = "default",
    capabilityRefs: readonly string[] = [],
  ) {
    return this.request("turn/start", {
      threadId,
      input,
      ...(mode === "plan" ? { mode } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(capabilityRefs.length > 0 ? { capabilityRefs } : {}),
    });
  }

  interruptTurn(threadId: string) {
    return this.request("turn/interrupt", { threadId });
  }

  processStatus(sessionId: string) {
    return this.request("process/status", { sessionId });
  }

  readProcess(sessionId: string) {
    return this.request("process/read", { sessionId });
  }

  waitForProcess(sessionId: string, timeoutMs?: number) {
    return this.request("process/wait", { sessionId, timeoutMs });
  }

  killProcess(sessionId: string) {
    return this.request("process/kill", { sessionId });
  }

  subscribe(listener: (notification: JsonRpcNotification) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  on<Method extends ThreadlightNotificationMethod>(
    method: Method,
    listener: (params: ThreadlightNotificationMap[Method]) => void,
  ) {
    return this.subscribe((notification) => {
      if (notification.method === method) {
        listener(notification.params as ThreadlightNotificationMap[Method]);
      }
    });
  }

  dispose(reason: unknown = new ClientClosedError()): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeTransport();
    this.listeners.clear();

    for (const request of this.pending.values()) request.reject(reason);
    this.pending.clear();
  }

  private handleMessage(message: JsonRpcOutgoing): void {
    if (!("id" in message)) {
      for (const listener of this.listeners) listener(message);
      return;
    }

    const request = this.pending.get(message.id);
    if (!request) return;
    this.pending.delete(message.id);

    if (message.error) {
      request.reject(
        new RpcResponseError(
          message.error.code,
          message.error.message,
          message.error.data,
        ),
      );
    } else {
      request.resolve(message.result);
    }
  }

  private rejectRequest(id: JsonRpcId, reason: unknown): void {
    const request = this.pending.get(id);
    if (!request) return;
    this.pending.delete(id);
    request.reject(reason);
  }
}
