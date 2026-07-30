import { HttpHostClient } from "@threadlight/client";
import type {
  HostProjectsSnapshot,
  HostSettingsSnapshot,
  HostSettingsUpdate,
  ThreadlightHostHealth,
} from "@threadlight/protocol";

export class RemoteHostConnection {
  readonly client: HttpHostClient;

  constructor(
    readonly endpoint: string,
    readonly token: string,
  ) {
    this.client = new HttpHostClient({ endpoint, token });
  }

  health(): Promise<ThreadlightHostHealth> {
    return this.client.health();
  }

  projects(): Promise<HostProjectsSnapshot> {
    return this.client.projects();
  }

  settings(): Promise<HostSettingsSnapshot> {
    return this.client.settings();
  }

  updateSettings(update: HostSettingsUpdate): Promise<HostSettingsSnapshot> {
    return this.client.updateSettings(update);
  }
}
