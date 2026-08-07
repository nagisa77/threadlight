import { describe, expect, it } from "vitest";

import {
  BrowserTerminalClient,
  HttpRuntimeTransport,
  SwitchableHttpRuntimeTransport,
  browserTerminalProtocols,
  type BrowserSocket,
  type BrowserSocketEvent,
} from "../src/index.js";

describe("HttpRuntimeTransport", () => {
  it("downloads raw workspace bytes with authentication", async () => {
    let request: Request | undefined;
    const transport = new HttpRuntimeTransport({
      endpoint: "https://host.example.test",
      token: "secret-token",
      projectId: "project one",
      fetch: (async (input, init) => {
        request = new Request(input, init);
        return new Response(Uint8Array.from([0, 1, 2, 255]));
      }) as typeof globalThis.fetch,
    });

    await expect(
      transport.downloadWorkspaceFile("output/file.pdf"),
    ).resolves.toEqual(Uint8Array.from([0, 1, 2, 255]).buffer);
    expect(request?.url).toBe(
      "https://host.example.test/v1/projects/project%20one/runtime/workspace/download?path=output%2Ffile.pdf",
    );
    expect(request?.headers.get("authorization")).toBe("Bearer secret-token");
    transport.close();
  });

  it("parses standard SSE data frames and ignores heartbeat comments", async () => {
    const encoder = new TextEncoder();
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });
    const transport = new HttpRuntimeTransport({
      endpoint: "https://host.example.test",
      token: "secret-token",
      fetch: (async () =>
        new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        })) as typeof globalThis.fetch,
    });
    const messages: unknown[] = [];
    const received = Promise.withResolvers<void>();
    transport.onMessage((message) => {
      messages.push(message);
      if (messages.length === 2) received.resolve();
    });

    streamController.enqueue(
      encoder.encode(
        ': ping\r\n\r\ndata: {"jsonrpc":"2.0","method":"turn/started",',
      ),
    );
    streamController.enqueue(
      encoder.encode(
        '"params":{"threadId":"thread-1"}}\r\n\r\n' +
          'data:{"jsonrpc":"2.0","method":"turn/completed",' +
          '"params":{"threadId":"thread-1","output":"done"}}\n\n',
      ),
    );

    await received.promise;
    expect(messages).toEqual([
      {
        jsonrpc: "2.0",
        method: "turn/started",
        params: { threadId: "thread-1" },
      },
      {
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { threadId: "thread-1", output: "done" },
      },
    ]);
    streamController.close();
    transport.close();
  });
});

describe("SwitchableHttpRuntimeTransport", () => {
  it("routes reusable workspace calls to the selected remote project", async () => {
    const urls: string[] = [];
    const fetcher = async (input: string | URL | Request) => {
      urls.push(String(input));
      return new Response(
        JSON.stringify([{ name: "src", path: "src", kind: "directory" }]),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };
    const transport = new SwitchableHttpRuntimeTransport({
      endpoint: "https://host.example.test",
      token: "secret-token",
      fetch: fetcher as typeof globalThis.fetch,
    });

    transport.activateProject("project one");
    await expect(transport.workspaceList("src")).resolves.toEqual([
      { name: "src", path: "src", kind: "directory" },
    ]);
    transport.activateProject("project-two");
    await transport.workspaceList();

    expect(urls).toEqual([
      "https://host.example.test/v1/projects/project%20one/runtime/workspace/list?path=src",
      "https://host.example.test/v1/projects/project-two/runtime/workspace/list?path=",
    ]);
    transport.close();
  });
});

describe("BrowserTerminalClient", () => {
  it("authenticates without putting the token in the WebSocket URL", async () => {
    const socket = new ScriptedBrowserSocket();
    let socketUrl = "";
    let protocols: readonly string[] = [];
    const events: unknown[] = [];
    const client = new BrowserTerminalClient({
      endpoint: "https://host.example.test/base",
      token: "a token/with+symbols",
      send: (event) => events.push(event),
      createSocket(url, selectedProtocols) {
        socketUrl = url;
        protocols = selectedProtocols;
        return socket;
      },
    });

    const opening = client.create({
      projectId: "project-1",
      threadId: "thread-1",
      workspace: "task",
      cols: 90,
      rows: 28,
    });
    socket.open();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = JSON.parse(socket.sent[0]!) as {
      requestId: string;
    };
    socket.message({
      type: "opened",
      requestId: request.requestId,
      session: {
        id: "terminal-1",
        shell: "zsh",
        cwd: "/workspace/threadlight-task",
        branch: "threadlight/task",
      },
    });

    await expect(opening).resolves.toEqual({
      id: "terminal-1",
      shell: "zsh",
      cwd: "/workspace/threadlight-task",
      branch: "threadlight/task",
    });
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      projectId: "project-1",
      threadId: "thread-1",
      workspace: "task",
    });
    expect(socketUrl).toBe("wss://host.example.test/v1/host/terminal");
    expect(socketUrl).not.toContain("token");
    expect(protocols).toEqual(browserTerminalProtocols("a token/with+symbols"));
    expect(protocols.join(",")).not.toContain("a token/with+symbols");

    client.write("terminal-1", "pwd\r");
    socket.message({
      type: "data",
      sessionId: "terminal-1",
      data: "/workspace\r\n",
    });
    expect(events).toContainEqual({
      type: "data",
      sessionId: "terminal-1",
      data: "/workspace\r\n",
    });
    client.dispose();
  });
});

class ScriptedBrowserSocket implements BrowserSocket {
  readyState = 0;
  readonly sent: string[] = [];
  private readonly listeners = new Map<
    string,
    Set<(event: BrowserSocketEvent) => void>
  >();

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  addEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: BrowserSocketEvent) => void,
  ): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(
    type: "open" | "message" | "close" | "error",
    listener: (event: BrowserSocketEvent) => void,
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }

  message(value: unknown): void {
    this.emit("message", { data: JSON.stringify(value) });
  }

  private emit(type: string, event: BrowserSocketEvent): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}
