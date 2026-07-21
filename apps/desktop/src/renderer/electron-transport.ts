import type { ClientTransport } from "@threadlight/client";
import type { JsonRpcOutgoing, JsonRpcRequest } from "@threadlight/protocol";

import type { DesktopApi } from "../shared/desktop-api.js";

export class ElectronTransport implements ClientTransport {
  constructor(private readonly api: DesktopApi = window.threadlightDesktop) {}

  send(message: JsonRpcRequest): void {
    this.api.send(message);
  }

  onMessage(listener: (message: JsonRpcOutgoing) => void): () => void {
    return this.api.onMessage(listener);
  }
}
