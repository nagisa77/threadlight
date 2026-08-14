import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";

import type { ProjectStore } from "./project-store.js";

export interface DesktopSecurityHost {
  readonly mainWindow: BrowserWindow | null;
  readonly projectStore: ProjectStore | null;
  currentProject(value: string): ReturnType<ProjectStore["project"]>;
}

/** Centralizes renderer trust and project identity checks for all IPC domains. */
export class DesktopSecurity {
  constructor(private readonly host: DesktopSecurityHost) {}

  requireProject(
    value: unknown,
  ): NonNullable<ReturnType<ProjectStore["project"]>> {
    if (!this.host.projectStore) throw new Error("Projects are not available");
    if (typeof value !== "string" || !value) {
      throw new Error("Invalid project id");
    }
    const project = this.host.currentProject(value);
    if (!project) throw new Error(`Unknown project: ${value}`);
    return project;
  }

  requireTrustedSender(event: IpcMainInvokeEvent): void {
    if (!this.isTrustedSender(event)) {
      throw new Error("Desktop request came from an untrusted frame");
    }
  }

  isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    const window = this.host.mainWindow;
    return (
      !!window &&
      event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame
    );
  }
}
