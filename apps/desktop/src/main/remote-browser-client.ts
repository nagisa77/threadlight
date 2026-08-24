import { BrowserStreamClient, type BrowserSocket } from "@threadlight/client";
import type {
  BrowserSessionEvent,
  BrowserSessionInfo,
  HostBrowserClientMessage,
} from "@threadlight/protocol";
import WebSocket from "ws";

export interface RemoteBrowserClientOptions {
  endpoint: string;
  token: string;
  send(event: BrowserSessionEvent): void;
}

export class RemoteBrowserClient {
  private readonly client: BrowserStreamClient;

  constructor(options: RemoteBrowserClientOptions) {
    this.client = new BrowserStreamClient({
      endpoint: options.endpoint,
      token: options.token,
      send: options.send,
      createSocket: (url, protocols) =>
        new WebSocket(url, [...protocols], {
          handshakeTimeout: 10_000,
          maxPayload: 32 * 1024 * 1024,
          perMessageDeflate: false,
        }) as unknown as BrowserSocket,
    });
  }

  create(request: {
    projectId: string;
    width: number;
    height: number;
    deviceScaleFactor?: number;
  }): Promise<BrowserSessionInfo> {
    return this.client.create(request);
  }

  owns(sessionId: string): boolean {
    return this.client.owns(sessionId);
  }

  command(command: Exclude<HostBrowserClientMessage, { type: "open" }>): void {
    this.client.command(command);
  }

  close(sessionId: string): void {
    this.client.close(sessionId);
  }

  dispose(): void {
    this.client.dispose();
  }
}
