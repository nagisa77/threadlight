import type {
  AttachmentData,
  HostAutomationCreateRequest,
  HostAutomationsSnapshot,
  HostAutomationUpdateRequest,
  HostCodeHostCommitPushResult,
  HostCodeHostDeliveryStatus,
  HostConversationChangesRestoreRequest,
  HostConversationChangesSnapshot,
  HostDirectoryListing,
  HostFileListing,
  HostProviderDiagnostic,
  HostProviderTestRequest,
  HostProjectsSnapshot,
  HostProjectDiagnosticsSnapshot,
  HostSearchRequest,
  HostSearchResult,
  HostSettingsSnapshot,
  HostSettingsUpdate,
  HostSystemFile,
  HostWorktreeDeliveryPreflight,
  HostWorktreeDeliveryHistorySnapshot,
  HostWorktreeDeliveryResult,
  HostWorktreeDeliveryUndoResult,
  ThreadlightHostHealth,
} from "@threadlight/protocol";

export interface HttpHostClientOptions {
  endpoint: string;
  token: string;
  fetch?: typeof globalThis.fetch;
}

export interface HostAttachmentUpload {
  projectId: string;
  name: string;
  mimeType: string;
  size: number;
  content: ArrayBuffer;
}

export interface HostAudioTranscriptionRequest {
  audio: ArrayBuffer;
  mimeType: string;
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

  diagnostics(projectId: string): Promise<HostProjectDiagnosticsSnapshot> {
    return this.request(
      `/v1/host/projects/${encodeURIComponent(projectId)}/diagnostics`,
    );
  }

  automations(projectId: string): Promise<HostAutomationsSnapshot> {
    return this.request(
      `/v1/host/projects/${encodeURIComponent(projectId)}/automations`,
    );
  }

  createAutomation(
    request: HostAutomationCreateRequest,
  ): Promise<HostAutomationsSnapshot> {
    return this.request("/v1/host/automations/create", {
      method: "POST",
      body: request,
    });
  }

  updateAutomation(
    request: HostAutomationUpdateRequest,
  ): Promise<HostAutomationsSnapshot> {
    return this.request("/v1/host/automations/update", {
      method: "POST",
      body: request,
    });
  }

  deleteAutomation(
    projectId: string,
    id: string,
  ): Promise<HostAutomationsSnapshot> {
    return this.request("/v1/host/automations/delete", {
      method: "POST",
      body: { projectId, id },
    });
  }

  runAutomation(
    projectId: string,
    id: string,
  ): Promise<HostAutomationsSnapshot> {
    return this.request("/v1/host/automations/run", {
      method: "POST",
      body: { projectId, id },
    });
  }

  search(
    request: HostSearchRequest,
  ): Promise<readonly HostSearchResult[]> {
    return this.request("/v1/host/search", {
      method: "POST",
      body: request,
    });
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

  async uploadAttachment(
    upload: HostAttachmentUpload,
  ): Promise<AttachmentData> {
    const query = new URLSearchParams({
      name: upload.name,
      mimeType: upload.mimeType,
      size: String(upload.size),
    });
    const response = await this.fetcher(
      `${this.endpoint}/v1/host/projects/${encodeURIComponent(upload.projectId)}/attachments?${query}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/octet-stream",
        },
        body: upload.content,
      },
    );
    return this.jsonResponse(response);
  }

  async downloadAttachment(
    projectId: string,
    attachmentId: string,
  ): Promise<ArrayBuffer> {
    const response = await this.fetcher(
      `${this.endpoint}/v1/host/projects/${encodeURIComponent(projectId)}/attachments/${encodeURIComponent(attachmentId)}`,
      {
        headers: {
          Authorization: `Bearer ${this.options.token}`,
        },
      },
    );
    if (!response.ok) {
      await this.throwResponseError(response);
    }
    return response.arrayBuffer();
  }

  registerProject(path: string): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/projects/register", {
      method: "POST",
      body: { path },
    });
  }

  createStandaloneTask(): Promise<HostProjectsSnapshot> {
    return this.request("/v1/host/projects/standalone", {
      method: "POST",
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

  conversationChanges(
    projectId: string,
    threadId: string,
  ): Promise<HostConversationChangesSnapshot> {
    return this.request(this.conversationAction(projectId, threadId, "changes"));
  }

  conversationWorkspaceList(
    projectId: string,
    threadId: string,
    path = "",
  ): Promise<
    readonly {
      name: string;
      path: string;
      type: "file" | "directory";
    }[]
  > {
    const query = new URLSearchParams({ path });
    return this.request(
      `${this.conversationAction(projectId, threadId, "workspace/list")}?${query}`,
    );
  }

  conversationWorkspaceFile(
    projectId: string,
    threadId: string,
    path: string,
  ): Promise<{
    path: string;
    name: string;
    content?: string;
    binary: boolean;
    size: number;
  }> {
    const query = new URLSearchParams({ path });
    return this.request(
      `${this.conversationAction(projectId, threadId, "workspace/file")}?${query}`,
    );
  }

  restoreConversationChanges(
    projectId: string,
    threadId: string,
    input: HostConversationChangesRestoreRequest,
  ): Promise<HostConversationChangesSnapshot> {
    return this.request(
      this.conversationAction(projectId, threadId, "changes/restore"),
      { method: "POST", body: input },
    );
  }

  preflightWorktreeDelivery(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<HostWorktreeDeliveryPreflight> {
    return this.request(
      this.conversationAction(projectId, threadId, "delivery/preflight"),
      { method: "POST", body: { revision } },
    );
  }

  worktreeDeliveryHistory(
    projectId: string,
    threadId: string,
  ): Promise<HostWorktreeDeliveryHistorySnapshot> {
    return this.request(
      this.conversationAction(projectId, threadId, "delivery/history"),
    );
  }

  applyWorktreeDelivery(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<HostWorktreeDeliveryResult> {
    return this.request(
      this.conversationAction(projectId, threadId, "delivery/apply"),
      { method: "POST", body: { revision } },
    );
  }

  undoWorktreeDelivery(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<HostWorktreeDeliveryUndoResult> {
    return this.request(
      this.conversationAction(projectId, threadId, "delivery/undo"),
      { method: "POST", body: { revision } },
    );
  }

  commitWorktreeDelivery(
    projectId: string,
    threadId: string,
    revision: string,
    message: string,
  ): Promise<HostWorktreeDeliveryResult> {
    return this.request(
      this.conversationAction(projectId, threadId, "delivery/commit"),
      { method: "POST", body: { revision, message } },
    );
  }

  codeHostDeliveryStatus(
    projectId: string,
    threadId: string,
    revision: string,
  ): Promise<HostCodeHostDeliveryStatus> {
    const query = new URLSearchParams({ revision });
    return this.request(
      `${this.conversationAction(projectId, threadId, "code-host/status")}?${query}`,
    );
  }

  commitAndPushCodeHostDelivery(
    projectId: string,
    threadId: string,
    revision: string,
    message: string,
  ): Promise<HostCodeHostCommitPushResult> {
    return this.request(
      this.conversationAction(projectId, threadId, "code-host/commit-push"),
      { method: "POST", body: { revision, message } },
    );
  }

  createDraftPullRequest(
    projectId: string,
    threadId: string,
    revision: string,
    title: string,
    body?: string,
  ): Promise<HostCodeHostDeliveryStatus> {
    return this.request(
      this.conversationAction(projectId, threadId, "code-host/create-pr"),
      {
        method: "POST",
        body: { revision, title, ...(body ? { body } : {}) },
      },
    );
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

  testProvider(
    request: HostProviderTestRequest,
  ): Promise<HostProviderDiagnostic> {
    return this.request("/v1/host/provider/test", {
      method: "POST",
      body: request,
    });
  }

  async transcribeAudio(
    request: HostAudioTranscriptionRequest,
  ): Promise<string> {
    const query = new URLSearchParams({ mimeType: request.mimeType });
    const response = await this.fetcher(
      `${this.endpoint}/v1/host/audio/transcriptions?${query}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          "Content-Type": "application/octet-stream",
        },
        body: request.audio,
      },
    );
    const result = await this.jsonResponse<{ text: string }>(response);
    if (typeof result.text !== "string" || !result.text.trim()) {
      throw new Error("语音转写没有返回文字，请重试。");
    }
    return result.text.trim();
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
    return this.jsonResponse(response);
  }

  private conversationAction(
    projectId: string,
    threadId: string,
    action: string,
  ): string {
    return `/v1/host/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(threadId)}/${action}`;
  }

  private async jsonResponse<Result>(response: Response): Promise<Result> {
    const payload = (await response.json()) as Result | { error?: string };
    if (!response.ok) {
      throw new Error(responseError(payload, response.status));
    }
    return payload as Result;
  }

  private async throwResponseError(response: Response): Promise<never> {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      // Binary endpoints can fail before a JSON response is available.
    }
    throw new Error(responseError(payload, response.status));
  }
}

function responseError(payload: unknown, status: number): string {
  return typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
    ? payload.error
    : `Threadlight Host request failed (${status}).`;
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
