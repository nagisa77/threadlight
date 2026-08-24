import type { BrowserWindow } from "electron";
import type { BrowserSessionEvent } from "@threadlight/protocol";
import {
  RemoteBrowserService,
  type RemoteBrowserSessions,
} from "@threadlight/host-core";

import { RemoteBrowserClient } from "./remote-browser-client.js";
import { DESKTOP_BROWSER_EVENT_CHANNEL } from "../shared/desktop-api.js";

interface BrowserHostConnection {
  endpoint: string;
  token: string;
}

/** Owns local Chrome and the optional remote Host browser connection. */
export class DesktopBrowserController {
  private service: RemoteBrowserService | null = null;
  private localSessions: RemoteBrowserSessions | null = null;
  private remote: RemoteBrowserClient | null = null;

  constructor(
    private readonly options: {
      window(): BrowserWindow | null;
      remoteHost(): BrowserHostConnection | null;
    },
  ) {}

  get sessions(): RemoteBrowserSessions | null {
    return this.localSessions;
  }

  get remoteClient(): RemoteBrowserClient | null {
    return this.remote;
  }

  initialize(homePath: string): void {
    this.service = new RemoteBrowserService({ homePath });
    this.localSessions = this.service.createSessions(this.send);
  }

  requireRemote(): RemoteBrowserClient {
    if (this.remote) return this.remote;
    const host = this.options.remoteHost();
    if (!host) throw new Error("Remote Host is not connected.");
    this.remote = new RemoteBrowserClient({ ...host, send: this.send });
    return this.remote;
  }

  resetSessions(): void {
    this.remote?.dispose();
    this.remote = null;
    const previous = this.localSessions;
    this.localSessions = this.service?.createSessions(this.send) ?? null;
    void previous?.dispose();
  }

  async close(): Promise<void> {
    this.remote?.dispose();
    this.remote = null;
    const sessions = this.localSessions;
    this.localSessions = null;
    await sessions?.dispose();
    const service = this.service;
    this.service = null;
    await service?.close();
  }

  sendError(sessionId: string | undefined, error: unknown): void {
    this.send({
      type: "error",
      ...(sessionId ? { sessionId } : {}),
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private readonly send = (event: BrowserSessionEvent): void => {
    const window = this.options.window();
    if (!window || window.isDestroyed()) return;
    window.webContents.send(DESKTOP_BROWSER_EVENT_CHANNEL, event);
  };
}
