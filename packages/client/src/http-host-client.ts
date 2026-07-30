import type {
  HostDirectoryListing,
  HostFileListing,
  HostProjectsSnapshot,
  HostSettingsSnapshot,
  HostSettingsUpdate,
  HostSystemFile,
  ThreadlightHostHealth,
} from "@threadlight/protocol";

export interface HttpHostClientOptions {
  endpoint: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}

export class HttpHostClient {
  private readonly endpoint: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(private readonly options: HttpHostClientOptions) {
    this.endpoint = normalizeEndpoint(options.endpoint);
    this.fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
    if (!options.token.trim()) {
      throw new Error("Threadlight Host token is required.");
    }
  }

  health(): Promise<ThreadlightHostHealth> {
    return this.request("/v1/health");
  }

  projects(): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/projects");
  }

  directories(path: string): Promise<HostDirectoryListing> {
    return this.request(
      `/v1/host/directories?path=${encodeURIComponent(path)}`,
    );
  }

  files(path: string): Promise<HostFileListing> {
    return this.request(
      `/v1/host/files?path=${encodeURIComponent(path)}`,
    );
  }

  file(path: string): Promise<HostSystemFile> {
    return this.request(
      `/v1/host/file?path=${encodeURIComponent(path)}`,
    );
  }

  registerProject(path: string): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/projects/register", {
      method: "POST",
      body: { path },
    });
  }

  activateProject(projectId: string): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/projects/activate", {
      method: "POST",
      body: { projectId },
    });
  }

  updateProject(input: {
    id: string;
    pinned: boolean;
  }): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/projects/update", {
      method: "POST",
      body: input,
    });
  }

  upsertConversation(input: {
    projectId: string;
    id: string;
    title: string;
  }): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/conversations/upsert", {
      method: "POST",
      body: input,
    });
  }

  updateConversation(input: {
    projectId: string;
    id: string;
    title?: string;
    pinned?: boolean;
    archived?: boolean;
    accessMode?: "approval" | "full";
  }): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/conversations/update", {
      method: "POST",
      body: input,
    });
  }

  markConversationRead(input: {
    projectId: string;
    id: string;
  }): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/conversations/read", {
      method: "POST",
      body: input,
    });
  }

  deleteConversation(input: {
    projectId: string;
    id: string;
  }): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/conversations/delete", {
      method: "POST",
      body: input,
    });
  }

  settings(): Promise<HostSettingsSnapshot> {
    return this.request("/v1/host/settings");
  }

  updateSettings(
    update: HostSettingsUpdate,
  ): Promise<HostSettingsSnapshot> {
    return this.request("/v1/host/settings", {
      method: "PUT",
      body: update,
    });
  }

  private async request<Result>(
    path: string,
    options: {
      method?: "POST" | "PUT";
      body?: unknown;
    } = {},
  ): Promise<Result> {
    const response = await this.fetcher(`${this.endpoint}${path}`, {
      method: options.method ?? "GET",
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        ...(options.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const payload = (await response.json()) as Result | { error?: string };
    if (!response.ok) {
      throw new Error(
        typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
          ? payload.error
          : `Threadlight Host request failed (${response.status}).`,
      );
    }
    return payload as Result;
  }
}

function normalizeEndpoint(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Threadlight Host endpoint must use http or https.");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
