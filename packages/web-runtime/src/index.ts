import {
  BrowserTerminalClient,
  HttpHostClient,
  SwitchableHttpRuntimeTransport,
  ThreadlightClient,
} from "@threadlight/client";
import {
  THREADLIGHT_HOST_PROTOCOL_VERSION,
  type HostDirectoryListOptions,
  type HostProjectsSnapshot,
  type HostProjectSummary,
  type ThreadlightHostHealth,
} from "@threadlight/protocol";
import type {
  AttachmentPreviewAdapter,
  AttachmentStageAdapter,
  AutomationAdapter,
  ClipboardAdapter,
  ConversationChangesSnapshot,
  ConnectorAuthorizationAdapter,
  DiagnosticsAdapter,
  ExecutionApprovalRequest,
  ExecutionApprovalScope,
  ExecutionPolicyAdapter,
  ExecutionPolicySnapshot,
  ProjectMemoryAdapter,
  ProjectsAdapter,
  ProjectsSnapshot,
  SearchAdapter,
  SettingsAdapter,
  SettingsSnapshot,
  TerminalAdapter,
  TerminalEvent,
  VoiceInputAdapter,
  WorkspaceAdapter,
} from "@threadlight/ui";

export interface RemoteWebCredentials {
  endpoint: string;
  token: string;
}

export interface RemoteWebSession {
  health: ThreadlightHostHealth;
  bootstrap: RemoteWebBootstrap;
  client: ThreadlightClient;
  clipboard: ClipboardAdapter;
  projects: ProjectsAdapter;
  settings: SettingsAdapter;
  diagnostics: DiagnosticsAdapter;
  automations: AutomationAdapter;
  search: SearchAdapter;
  attachmentStage: AttachmentStageAdapter;
  attachmentPreview: AttachmentPreviewAdapter;
  voiceInput: VoiceInputAdapter;
  connectorAuthorization: ConnectorAuthorizationAdapter;
  memory: ProjectMemoryAdapter;
  workspace: WorkspaceAdapter;
  terminal?: TerminalAdapter;
  executionPolicy: ExecutionPolicyAdapter;
  dispose(): void;
}

export interface RemoteWebBootstrap {
  projects: ProjectsSnapshot;
  settings: SettingsSnapshot;
}

export interface CreateRemoteWebSessionOptions extends RemoteWebCredentials {
  fetch?: typeof globalThis.fetch;
  storage?: Pick<Storage, "getItem" | "setItem">;
  createTerminalSocket?: ConstructorParameters<
    typeof BrowserTerminalClient
  >[0]["createSocket"];
  openOAuthWindow?: () => OAuthWindowHandle | null;
}

export interface OAuthWindowHandle {
  closed: boolean;
  location: { replace(url: string): void };
  close(): void;
}

function displayProtocolVersion(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "unknown";
}

function numericProtocolVersion(value: unknown): number | undefined {
  const version =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(version) ? version : undefined;
}

export class IncompatibleHostProtocolError extends Error {
  readonly name = "IncompatibleHostProtocolError";
  readonly clientProtocolVersion = THREADLIGHT_HOST_PROTOCOL_VERSION;
  readonly hostProtocolVersion: unknown;
  readonly upgradeTarget: "host" | "web" | "both";

  constructor(hostProtocolVersion: unknown) {
    const hostVersion = displayProtocolVersion(hostProtocolVersion);
    const hostVersionNumber = numericProtocolVersion(hostProtocolVersion);
    const upgradeTarget =
      hostVersionNumber === undefined ||
      hostVersionNumber === THREADLIGHT_HOST_PROTOCOL_VERSION
        ? "both"
        : hostVersionNumber < THREADLIGHT_HOST_PROTOCOL_VERSION
          ? "host"
          : "web";
    const advice =
      upgradeTarget === "host"
        ? `Update the Threadlight Host to a release that supports protocol ${THREADLIGHT_HOST_PROTOCOL_VERSION}, then reconnect.`
        : upgradeTarget === "web"
          ? `Update this Threadlight Web client to a release that supports protocol ${hostVersion}, then reconnect.`
          : "Update the Threadlight Web client and Host to compatible releases, then reconnect.";
    super(
      `Incompatible Threadlight protocol. Web client protocol version: ${THREADLIGHT_HOST_PROTOCOL_VERSION}. Host protocol version: ${hostVersion}. ${advice}`,
    );
    this.hostProtocolVersion = hostProtocolVersion;
    this.upgradeTarget = upgradeTarget;
  }
}

export async function createRemoteWebSession(
  options: CreateRemoteWebSessionOptions,
): Promise<RemoteWebSession> {
  const host = new HttpHostClient({
    endpoint: options.endpoint,
    token: options.token,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const health = await host.health();
  if (health.protocolVersion !== THREADLIGHT_HOST_PROTOCOL_VERSION) {
    throw new IncompatibleHostProtocolError(health.protocolVersion);
  }
  const [initialProjects, initialSettings] = await Promise.all([
    host.projects(),
    host.settings(),
  ]);
  const transport = new SwitchableHttpRuntimeTransport({
    endpoint: options.endpoint,
    token: options.token,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const client = new ThreadlightClient(transport, {
    capabilities: { executionApprovals: true },
  });
  const projects = new RemoteWebProjectsAdapter(
    host,
    transport,
    health,
    options.endpoint,
    initialProjects,
  );
  let initialSettingsAvailable = true;
  const settings: SettingsAdapter = {
    load: () => {
      if (initialSettingsAvailable) {
        initialSettingsAvailable = false;
        return Promise.resolve(initialSettings);
      }
      return host.settings();
    },
    save: (update) => host.updateSettings(update),
    testProvider: (request) => host.testProvider(request),
  };
  const diagnostics: DiagnosticsAdapter = {
    load: (projectId) => host.diagnostics(projectId),
    exportBundle: (projectId, conversationIds) =>
      host.diagnosticBundle(projectId, conversationIds),
  };
  const automations: AutomationAdapter = {
    load: (projectId) => host.automations(projectId),
    create: (request) => host.createAutomation(request),
    update: (request) => host.updateAutomation(request),
    delete: (projectId, id) => host.deleteAutomation(projectId, id),
    run: (projectId, id) => host.runAutomation(projectId, id),
    subscribe: () => () => undefined,
  };
  const search: SearchAdapter = {
    search: (projectId, threadId, query, mode) =>
      host.search({
        projectId,
        ...(threadId ? { threadId } : {}),
        query,
        mode,
        limit: 80,
      }),
  };
  const attachments = remoteAttachmentAdapters(host, projects);
  const voiceInput: VoiceInputAdapter = {
    async prepare() {
      const snapshot = await host.settings();
      if (!snapshot.openAIApiKeyConfigured) {
        throw new Error("请先在设置中配置 OpenAI API Key，再使用语音输入。");
      }
    },
    transcribe: (recording) => host.transcribeAudio(recording),
  };
  const connectorAuthorization = remoteConnectorAuthorization(
    client,
    options.openOAuthWindow ??
      (() => window.open("about:blank", "threadlight-oauth")),
  );
  const workspace = remoteWorkspaceAdapter(host, transport);
  const memory = remoteMemoryAdapter(transport);
  const terminal = health.capabilities?.terminal
    ? remoteTerminalAdapter({
        endpoint: options.endpoint,
        token: options.token,
        ...(options.createTerminalSocket
          ? { createSocket: options.createTerminalSocket }
          : {}),
      })
    : undefined;
  const executionPolicy = new RemoteExecutionPolicyAdapter(
    client,
    projects,
    options.storage ?? safeLocalStorage(),
  );

  return {
    health,
    bootstrap: {
      projects: projects.bootstrapSnapshot(),
      settings: initialSettings,
    },
    client,
    clipboard: {
      writeText: (text) => writeClipboardText(text),
    },
    projects,
    settings,
    diagnostics,
    automations,
    search,
    attachmentStage: attachments.stage,
    attachmentPreview: attachments.preview,
    voiceInput,
    connectorAuthorization,
    memory,
    workspace,
    ...(terminal ? { terminal } : {}),
    executionPolicy,
    dispose() {
      attachments.dispose();
      executionPolicy.dispose();
      terminal?.dispose();
      client.dispose();
      transport.close();
    },
  };
}

function remoteConnectorAuthorization(
  client: ThreadlightClient,
  openWindow: () => OAuthWindowHandle | null,
): ConnectorAuthorizationAdapter {
  return {
    async authorize<Result>(action: () => Promise<Result>) {
      const popup = openWindow();
      if (!popup) {
        throw new Error(
          "浏览器阻止了 OAuth 授权窗口，请允许此站点打开弹窗后重试。",
        );
      }
      let navigated = false;
      let rejectNavigation!: (error: unknown) => void;
      const navigationFailure = new Promise<never>((_resolve, reject) => {
        rejectNavigation = reject;
      });
      const unsubscribe = client.on(
        "connector/authorization-requested",
        ({ url }) => {
          try {
            const authorizationUrl = new URL(url);
            if (authorizationUrl.protocol !== "https:") {
              throw new Error("OAuth authorization URL must use HTTPS.");
            }
            if (popup.closed) {
              throw new Error("OAuth 授权窗口已关闭，请重新连接。");
            }
            popup.location.replace(authorizationUrl.toString());
            navigated = true;
          } catch (error) {
            popup.close();
            rejectNavigation(error);
          }
        },
      );
      try {
        const result = await Promise.race([action(), navigationFailure]);
        popup.close();
        return result;
      } catch (error) {
        if (!navigated || !popup.closed) popup.close();
        throw error;
      } finally {
        unsubscribe();
      }
    },
  };
}

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

function remoteAttachmentAdapters(
  host: HttpHostClient,
  projects: RemoteWebProjectsAdapter,
): {
  stage: AttachmentStageAdapter;
  preview: AttachmentPreviewAdapter;
  dispose(): void;
} {
  const urls = new Map<string, string>();
  const loading = new Map<string, Promise<string | undefined>>();
  let disposed = false;
  const activeKey = (attachmentId: string): string | undefined => {
    const projectId = projects.activeProject()?.id;
    return projectId ? `${projectId}:${attachmentId}` : undefined;
  };
  const remember = (key: string, url: string): string => {
    if (disposed) {
      URL.revokeObjectURL(url);
      return url;
    }
    const previous = urls.get(key);
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    urls.set(key, url);
    return url;
  };

  return {
    stage: {
      async stage(file) {
        const project = projects.activeProject();
        if (!project) {
          throw new Error("Open a project before adding an attachment.");
        }
        if (
          !Number.isSafeInteger(file.size) ||
          file.size <= 0 ||
          file.size > MAX_ATTACHMENT_BYTES
        ) {
          throw new Error(
            "Attachments must be non-empty and smaller than 50 MB.",
          );
        }
        const attachment = await host.uploadAttachment({
          projectId: project.id,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          content: await file.arrayBuffer(),
        });
        if (attachment.kind === "image") {
          remember(`${project.id}:${attachment.id}`, URL.createObjectURL(file));
        }
        return attachment;
      },
    },
    preview: {
      imageUrl(attachment) {
        const key = activeKey(attachment.id);
        return key ? urls.get(key) : undefined;
      },
      async loadImageUrl(attachment) {
        const project = projects.activeProject();
        if (!project || attachment.kind !== "image") return;
        const key = `${project.id}:${attachment.id}`;
        const existing = urls.get(key);
        if (existing) return existing;
        const pending = loading.get(key);
        if (pending) return pending;
        const request = host
          .downloadAttachment(project.id, attachment.id)
          .then((content) =>
            remember(
              key,
              URL.createObjectURL(
                new Blob([content], { type: attachment.mimeType }),
              ),
            ),
          )
          .finally(() => loading.delete(key));
        loading.set(key, request);
        return request;
      },
    },
    dispose() {
      disposed = true;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
      loading.clear();
    },
  };
}

class RemoteWebProjectsAdapter implements ProjectsAdapter {
  private snapshot: HostProjectsSnapshot;
  private activeProjectId?: string;

  constructor(
    private readonly host: HttpHostClient,
    private readonly transport: SwitchableHttpRuntimeTransport,
    private readonly health: ThreadlightHostHealth,
    private readonly endpoint: string,
    initialSnapshot: HostProjectsSnapshot,
  ) {
    this.snapshot = initialSnapshot;
    this.activeProjectId = clientActiveProjectId(initialSnapshot);
    this.activateRuntime();
  }

  async load(): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.projects());
  }

  bootstrapSnapshot(): ProjectsSnapshot {
    return this.toClientSnapshot();
  }

  async openFolder(path?: string): Promise<ProjectsSnapshot> {
    if (!path?.trim()) {
      throw new Error("Enter an absolute project path on the remote Host.");
    }
    const snapshot = await this.host.registerProject(path.trim());
    return this.sync(snapshot, snapshot.activeProjectId);
  }

  async createStandalone(): Promise<ProjectsSnapshot> {
    const snapshot = await this.host.createStandaloneTask();
    return this.sync(snapshot, snapshot.activeProjectId);
  }

  loadHosts() {
    return Promise.resolve({
      activeHostId: this.health.hostId,
      hosts: [
        {
          id: this.health.hostId,
          name: this.health.name,
          kind: "remote" as const,
          endpoint: this.endpoint,
        },
      ],
    });
  }

  listRemoteDirectories = (path: string, options?: HostDirectoryListOptions) =>
    this.host.directories(path, options);

  async activate(projectId: string): Promise<ProjectsSnapshot> {
    const snapshot = await this.host.projects();
    if (!snapshot.projects.some((project) => project.id === projectId)) {
      throw new Error(`Unknown project: ${projectId}`);
    }
    return this.sync(snapshot, projectId);
  }

  async updateProject(update: {
    id: string;
    pinned: boolean;
  }): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.updateProject(update));
  }

  async deleteProject(projectId: string): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.deleteProject(projectId));
  }

  async upsertConversation(update: {
    projectId: string;
    id: string;
    title: string;
  }): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.upsertConversation(update));
  }

  async updateConversation(update: {
    projectId: string;
    id: string;
    title?: string;
    pinned?: boolean;
    archived?: boolean;
    accessMode?: "approval" | "full";
  }): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.updateConversation(update));
  }

  async markConversationRead(target: {
    projectId: string;
    id: string;
  }): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.markConversationRead(target));
  }

  async recoverConversation(request: {
    projectId: string;
    id: string;
    replacementId?: string;
  }): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.recoverConversation(request));
  }

  async deleteConversation(target: {
    projectId: string;
    id: string;
  }): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.deleteConversation(target));
  }

  project(projectId: string): HostProjectSummary | undefined {
    return this.snapshot.projects.find(({ id }) => id === projectId);
  }

  projectForThread(threadId: string): HostProjectSummary | undefined {
    return this.snapshot.projects.find((project) =>
      project.conversations.some(
        (conversation) => conversation.id === threadId,
      ),
    );
  }

  routeRuntime(projectId: string): void {
    this.transport.activateProject(projectId);
  }

  activeProject(): HostProjectSummary | undefined {
    return this.snapshot.projects.find(({ id }) => id === this.activeProjectId);
  }

  private sync(
    snapshot: HostProjectsSnapshot,
    preferredProjectId = this.activeProjectId,
  ): ProjectsSnapshot {
    this.snapshot = snapshot;
    this.activeProjectId = clientActiveProjectId(snapshot, preferredProjectId);
    this.activateRuntime();
    return this.toClientSnapshot();
  }

  private toClientSnapshot(): ProjectsSnapshot {
    return {
      ...(this.activeProjectId
        ? { activeProjectId: this.activeProjectId }
        : {}),
      ...(this.snapshot.runningThreadIds
        ? { runningThreadIds: this.snapshot.runningThreadIds }
        : {}),
      projects: this.snapshot.projects.map((project) => ({
        ...project,
        runtime: {
          kind: "remote" as const,
          endpoint: this.endpoint,
          workspacePath: project.basePath,
          runtimeId: `${this.health.hostId}:${project.id}`,
        },
      })),
    };
  }

  private activateRuntime(): void {
    if (this.activeProjectId) {
      this.transport.activateProject(this.activeProjectId);
    }
  }
}

export function clientActiveProjectId(
  snapshot: HostProjectsSnapshot,
  preferredProjectId?: string,
): string | undefined {
  if (
    preferredProjectId &&
    snapshot.projects.some((project) => project.id === preferredProjectId)
  ) {
    return preferredProjectId;
  }
  if (
    snapshot.activeProjectId &&
    snapshot.projects.some((project) => project.id === snapshot.activeProjectId)
  ) {
    return snapshot.activeProjectId;
  }
  return snapshot.projects[0]?.id;
}

function remoteWorkspaceAdapter(
  host: HttpHostClient,
  transport: SwitchableHttpRuntimeTransport,
): WorkspaceAdapter {
  const activate = (projectId: string) => transport.activateProject(projectId);
  return {
    async getChanges(projectId, threadId) {
      activate(projectId);
      return host.conversationChanges(projectId, threadId);
    },
    restoreChanges(projectId, threadId, revision, paths) {
      return host.restoreConversationChanges(projectId, threadId, {
        revision,
        ...(paths ? { paths } : {}),
      });
    },
    preflightDelivery: (projectId, threadId, revision) =>
      host.preflightWorktreeDelivery(projectId, threadId, revision),
    getDeliveryHistory: (projectId, threadId) =>
      host.worktreeDeliveryHistory(projectId, threadId),
    applyDelivery: (projectId, threadId, revision) =>
      host.applyWorktreeDelivery(projectId, threadId, revision),
    undoDelivery: (projectId, threadId, revision) =>
      host.undoWorktreeDelivery(projectId, threadId, revision),
    commitDelivery: (projectId, threadId, revision, message) =>
      host.commitWorktreeDelivery(projectId, threadId, revision, message),
    getCodeHostStatus: (projectId, threadId, revision) =>
      host.codeHostDeliveryStatus(projectId, threadId, revision),
    commitAndPush: (projectId, threadId, revision, message) =>
      host.commitAndPushCodeHostDelivery(
        projectId,
        threadId,
        revision,
        message,
      ),
    createPullRequest: (projectId, threadId, revision, title, body, draft) =>
      host.createPullRequest(projectId, threadId, revision, title, body, draft),
    async list(projectId, path, threadId) {
      activate(projectId);
      if (threadId) {
        return host.conversationWorkspaceList(projectId, threadId, path);
      }
      const entries = await transport.workspaceList(path);
      return entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.kind,
      }));
    },
    async read(projectId, path, threadId) {
      activate(projectId);
      if (threadId) {
        return host.conversationWorkspaceFile(projectId, threadId, path);
      }
      const file = await transport.workspaceFile(path);
      return {
        path: file.path,
        name: file.path.split("/").at(-1) ?? file.path,
        ...(file.binary ? {} : { content: file.content }),
        binary: file.binary,
        size: file.size,
      };
    },
    async download(projectId, path, threadId) {
      activate(projectId);
      return threadId
        ? host.downloadConversationWorkspaceFile(projectId, threadId, path)
        : transport.downloadWorkspaceFile(path);
    },
    listSystemFiles: (path) => host.files(path),
    async readSystemFile(path) {
      const file = await host.file(path);
      return {
        path: file.path,
        name: file.name,
        ...(file.content === undefined ? {} : { content: file.content }),
        binary: file.binary,
        size: file.size,
      };
    },
    downloadSystemFile: (path) => host.downloadFile(path),
  };
}

function remoteMemoryAdapter(
  transport: SwitchableHttpRuntimeTransport,
): ProjectMemoryAdapter {
  const snapshots = new Map<
    string,
    { path: string; content: string; revision: string }
  >();
  const load = async (projectId: string) => {
    transport.activateProject(projectId);
    const file = await transport
      .workspaceFile(".threadlight/MEMORY.md")
      .catch(() => ({
        path: ".threadlight/MEMORY.md",
        content: "",
        binary: false,
        size: 0,
      }));
    const snapshot = {
      path: file.path,
      content: file.content,
      revision: `remote:${file.size}:${file.content.length}`,
    };
    snapshots.set(projectId, snapshot);
    return snapshot;
  };
  return {
    load,
    async open(projectId) {
      const snapshot = snapshots.get(projectId) ?? (await load(projectId));
      const blob = new Blob([snapshot.content], {
        type: "text/markdown;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (!opened) {
        throw new Error("Allow pop-ups to open the remote memory file.");
      }
    },
  };
}

function remoteTerminalAdapter(
  options: Omit<ConstructorParameters<typeof BrowserTerminalClient>[0], "send">,
): TerminalAdapter & { dispose(): void } {
  const listeners = new Set<(event: TerminalEvent) => void>();
  const client = new BrowserTerminalClient({
    ...options,
    send: (event) => {
      for (const listener of listeners) listener(event);
    },
  });
  return {
    create: (request) => client.create(request),
    write: ({ sessionId, data }) => client.write(sessionId, data),
    resize: ({ sessionId, cols, rows }) => client.resize(sessionId, cols, rows),
    async close(sessionId) {
      client.close(sessionId);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      client.dispose();
      listeners.clear();
    },
  };
}

interface StoredExecutionGrant {
  projectId: string;
  permissionKey: string;
  label: string;
  external: boolean;
  grantedAt: string;
}

class RemoteExecutionPolicyAdapter implements ExecutionPolicyAdapter {
  private readonly requests = new Set<
    (request: ExecutionApprovalRequest) => void
  >();
  private readonly resolved = new Set<(requestId: string) => void>();
  private readonly pending = new Map<string, ExecutionApprovalRequest>();
  private readonly taskGrants = new Set<string>();
  private grants: StoredExecutionGrant[];
  private readonly unsubscribes: Array<() => void>;

  constructor(
    private readonly client: ThreadlightClient,
    private readonly projects: RemoteWebProjectsAdapter,
    private readonly storage?: Pick<Storage, "getItem" | "setItem">,
  ) {
    this.grants = readExecutionGrants(storage);
    this.unsubscribes = [
      client.on("execution/approval-required", (request) => {
        void this.receive(request).catch(() => undefined);
      }),
      client.on("execution/approval-resolved", ({ requestId }) => {
        this.pending.delete(requestId);
        for (const listener of this.resolved) listener(requestId);
      }),
    ];
  }

  subscribe(listener: (request: ExecutionApprovalRequest) => void): () => void {
    this.requests.add(listener);
    for (const request of this.pending.values()) listener(request);
    return () => this.requests.delete(listener);
  }

  subscribeResolved(listener: (requestId: string) => void): () => void {
    this.resolved.add(listener);
    return () => this.resolved.delete(listener);
  }

  async respond(
    requestId: string,
    decision: "allow" | "deny",
    scope: ExecutionApprovalScope,
  ): Promise<void> {
    const request = this.pending.get(requestId);
    if (!request) {
      throw new Error("This approval request is no longer pending.");
    }
    if (scope === "project" && request.projectScopeAvailable === false) {
      throw new Error(
        "Permanent project approval is unavailable outside a project.",
      );
    }
    this.projects.routeRuntime(request.projectId);
    await this.client.request("execution/approval/respond", {
      requestId,
      decision,
      threadId: request.threadId,
    });
    if (decision === "allow" && scope === "task") {
      this.taskGrants.add(taskGrantKey(request));
    } else if (decision === "allow" && scope === "project") {
      this.grants = [
        ...this.grants.filter(
          (grant) =>
            grant.projectId !== request.projectId ||
            grant.permissionKey !== request.permissionKey,
        ),
        {
          projectId: request.projectId,
          permissionKey: request.permissionKey,
          label: request.summary,
          external: request.external,
          grantedAt: new Date().toISOString(),
        },
      ];
      this.save();
    }
    this.pending.delete(requestId);
  }

  load(projectId: string): Promise<ExecutionPolicySnapshot> {
    return Promise.resolve(this.snapshot(projectId));
  }

  revoke(
    projectId: string,
    permissionKey: string,
  ): Promise<ExecutionPolicySnapshot> {
    this.grants = this.grants.filter(
      (grant) =>
        grant.projectId !== projectId || grant.permissionKey !== permissionKey,
    );
    this.save();
    return Promise.resolve(this.snapshot(projectId));
  }

  dispose(): void {
    this.unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.requests.clear();
    this.resolved.clear();
    this.pending.clear();
    this.taskGrants.clear();
  }

  private async receive(
    input: Omit<ExecutionApprovalRequest, "projectId" | "projectName">,
  ): Promise<void> {
    const project =
      this.projects.projectForThread(input.threadId) ??
      this.projects.activeProject();
    if (!project) {
      await this.client.request("execution/approval/respond", {
        requestId: input.requestId,
        decision: "deny",
        threadId: input.threadId,
      });
      return;
    }
    const request: ExecutionApprovalRequest = {
      ...input,
      projectId: project.id,
      projectName: project.name,
      projectScopeAvailable: project.scope !== "standalone",
    };
    if (
      this.taskGrants.has(taskGrantKey(request)) ||
      this.grants.some(
        (grant) =>
          grant.projectId === request.projectId &&
          grant.permissionKey === request.permissionKey,
      )
    ) {
      try {
        this.projects.routeRuntime(request.projectId);
        await this.client.request("execution/approval/respond", {
          requestId: request.requestId,
          decision: "allow",
          threadId: request.threadId,
        });
        return;
      } catch {
        // A stale automatic grant must not leave the turn waiting invisibly.
        // Fall through to an explicit approval that the user can retry.
      }
    }
    this.pending.set(request.requestId, request);
    for (const listener of this.requests) listener(request);
  }

  private snapshot(projectId: string): ExecutionPolicySnapshot {
    return {
      projectId,
      rules: {
        read: "allow",
        write: "ask",
        destructive: "deny",
      },
      permanentGrants: this.grants
        .filter((grant) => grant.projectId === projectId)
        .map(({ permissionKey, label, external, grantedAt }) => ({
          permissionKey,
          label,
          external,
          grantedAt,
        })),
    };
  }

  private save(): void {
    try {
      this.storage?.setItem(
        EXECUTION_GRANTS_STORAGE_KEY,
        JSON.stringify(this.grants),
      );
    } catch {
      // The current page keeps the grant when persistent storage is blocked.
    }
  }
}

const EXECUTION_GRANTS_STORAGE_KEY = "threadlight:web:execution-policy:v1";

function readExecutionGrants(
  storage?: Pick<Storage, "getItem" | "setItem">,
): StoredExecutionGrant[] {
  try {
    const value = storage?.getItem(EXECUTION_GRANTS_STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredExecutionGrant);
  } catch {
    return [];
  }
}

function isStoredExecutionGrant(value: unknown): value is StoredExecutionGrant {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const grant = value as Record<string, unknown>;
  return (
    typeof grant.projectId === "string" &&
    typeof grant.permissionKey === "string" &&
    typeof grant.label === "string" &&
    typeof grant.external === "boolean" &&
    typeof grant.grantedAt === "string"
  );
}

function taskGrantKey(
  request: Pick<
    ExecutionApprovalRequest,
    "projectId" | "threadId" | "permissionKey"
  >,
): string {
  return `${request.projectId}\0${request.threadId}\0${request.permissionKey}`;
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access is unavailable.");
}

function safeLocalStorage(): Pick<Storage, "getItem" | "setItem"> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return;
  }
}
