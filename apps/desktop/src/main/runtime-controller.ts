import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type { TerminalSessionManager } from "@threadlight/terminal-core";

import type { DesktopComputerService } from "./computer-service.js";
import type { ProjectStore } from "./project-store.js";
import type { RemoteTerminalClient } from "./remote-terminal-client.js";
import { resolveTerminalWorkspace } from "./task-workspace.js";
import {
  parseTerminalCreateRequest,
  parseTerminalResizeRequest,
  parseTerminalWriteRequest,
} from "./ipc-workspace-parsers.js";

export interface DesktopRuntimeControllerHost {
  readonly terminalService: TerminalSessionManager | null;
  readonly remoteTerminalClient: RemoteTerminalClient | null;
  readonly computerService: DesktopComputerService | null;
  readonly mainWindow: BrowserWindow | null;
  requireProject(
    value: unknown,
  ): NonNullable<ReturnType<ProjectStore["project"]>>;
  requireRemoteTerminalClient(): RemoteTerminalClient;
  requireTrustedSender(event: IpcMainInvokeEvent): void;
  isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean;
}

/** Owns terminal sessions and the computer preview IPC behavior. */
export class DesktopRuntimeController {
  constructor(private readonly host: DesktopRuntimeControllerHost) {}

  async handleTerminalCreate(event: IpcMainInvokeEvent, value: unknown) {
    this.host.requireTrustedSender(event);
    if (!this.host.terminalService)
      throw new Error("Terminal is not available");
    const request = parseTerminalCreateRequest(value);
    const project = this.host.requireProject(request.projectId);
    if (project.runtime?.kind === "remote") {
      return this.host.requireRemoteTerminalClient().create(request);
    }
    const workspace = resolveTerminalWorkspace(
      project,
      request.threadId,
      request.workspace,
    );
    const session = this.host.terminalService.create(
      workspace.cwd,
      request.cols,
      request.rows,
    );
    return { ...session, ...workspace };
  }

  handleTerminalWrite(event: IpcMainEvent, value: unknown): void {
    if (!this.host.isTrustedSender(event) || !this.host.terminalService) return;
    try {
      const request = parseTerminalWriteRequest(value);
      if (this.host.remoteTerminalClient?.owns(request.sessionId)) {
        this.host.remoteTerminalClient.write(request.sessionId, request.data);
      } else {
        this.host.terminalService.write(request.sessionId, request.data);
      }
    } catch {
      // Input can race with a shell exiting. A fire-and-forget IPC event has
      // nowhere useful to surface that stale write, so safely ignore it.
    }
  }

  handleTerminalResize(event: IpcMainEvent, value: unknown): void {
    if (!this.host.isTrustedSender(event) || !this.host.terminalService) return;
    try {
      const request = parseTerminalResizeRequest(value);
      if (this.host.remoteTerminalClient?.owns(request.sessionId)) {
        this.host.remoteTerminalClient.resize(
          request.sessionId,
          request.cols,
          request.rows,
        );
      } else {
        this.host.terminalService.resize(
          request.sessionId,
          request.cols,
          request.rows,
        );
      }
    } catch {
      // ResizeObserver can emit once more while an exited terminal is unmounting.
    }
  }

  handleTerminalClose(event: IpcMainInvokeEvent, value: unknown): void {
    this.host.requireTrustedSender(event);
    if (!this.host.terminalService) return;
    if (typeof value !== "string" || !value) {
      throw new Error("Invalid terminal session id");
    }
    if (this.host.remoteTerminalClient?.owns(value)) {
      this.host.remoteTerminalClient.close(value);
    } else {
      this.host.terminalService.close(value);
    }
  }

  handleComputerPreviewClose(event: IpcMainEvent): void {
    if (!this.host.computerService?.ownsPreviewWebContents(event.sender))
      return;
    this.host.computerService.closePictureInPicture();
  }

  handleComputerPreviewResize(event: IpcMainEvent, value: unknown): void {
    if (
      !this.host.computerService?.ownsPreviewWebContents(event.sender) ||
      typeof value !== "number"
    ) {
      return;
    }
    this.host.computerService.resizePictureInPicture(value);
  }

  handleComputerPreviewDrag(event: IpcMainEvent, value: unknown): void {
    if (
      !this.host.computerService?.ownsPreviewWebContents(event.sender) ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      return;
    }
    const drag = value as Record<string, unknown>;
    if (
      (drag.phase !== "start" &&
        drag.phase !== "move" &&
        drag.phase !== "end") ||
      typeof drag.x !== "number" ||
      typeof drag.y !== "number"
    ) {
      return;
    }
    this.host.computerService.dragPictureInPicture(drag.phase, drag.x, drag.y);
  }
}
