import {
  BrowserTerminalClient,
  HttpHostClient,
  SwitchableHttpRuntimeTransport,
  ThreadlightClient,
} from "@threadlight/client";
import type {
  HostProjectsSnapshot,
  HostProjectSummary,
  ThreadlightHostHealth,
} from "@threadlight/protocol";
import type {
  ClipboardAdapter,
  ConversationChangesSnapshot,
  ExecutionApprovalRequest,
  ExecutionApprovalScope,
  ExecutionPolicyAdapter,
  ExecutionPolicySnapshot,
  ProjectMemoryAdapter,
  ProjectsAdapter,
  ProjectsSnapshot,
  SettingsAdapter,
  TerminalAdapter,
  TerminalEvent,
  WorkspaceAdapter,
} from "@threadlight/ui";

export interface RemoteWebCredentials {
  endpoint: string;
  token: string;
}

export interface RemoteWebSession {
  health: ThreadlightHostHealth;
  client: ThreadlightClient;
  clipboard: ClipboardAdapter;
  projects: ProjectsAdapter;
  settings: SettingsAdapter;
  memory: ProjectMemoryAdapter;
  workspace: WorkspaceAdapter;
  terminal?: TerminalAdapter;
  executionPolicy: ExecutionPolicyAdapter;
  dispose(): void;
}

export interface CreateRemoteWebSessionOptions extends RemoteWebCredentials {
  fetch?: typeof globalThis.fetch;
  storage?: Pick<Storage, "getItem" | "setItem">;
  createTerminalSocket?: ConstructorParameters<
    typeof BrowserTerminalClient
  >[0]["createSocket"];
}

export async function createRemoteWebSession(
  options: CreateRemoteWebSessionOptions,
): Promise<RemoteWebSession> {
  const host = new HttpHostClient({
    endpoint: options.endpoint,
    token: options.token,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const [health, initialProjects] = await Promise.all([
    host.health(),
    host.projects(),
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
  const settings: SettingsAdapter = {
    load: () => host.settings(),
    save: (update) => host.updateSettings(update),
  };
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
    client,
    clipboard: {
      writeText: (text) => writeClipboardText(text),
    },
    projects,
    settings,
    memory,
    workspace,
    ...(terminal ? { terminal } : {}),
    executionPolicy,
    dispose() {
      executionPolicy.dispose();
      terminal?.dispose();
      client.dispose();
      transport.close();
    },
  };
}

class RemoteWebProjectsAdapter implements ProjectsAdapter {
  private snapshot: HostProjectsSnapshot;

  constructor(
    private readonly host: HttpHostClient,
    private readonly transport: SwitchableHttpRuntimeTransport,
    private readonly health: ThreadlightHostHealth,
    private readonly endpoint: string,
    initialSnapshot: HostProjectsSnapshot,
  ) {
    this.snapshot = initialSnapshot;
    this.activateRuntime(initialSnapshot);
  }

  async load(): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.projects());
  }

  async openFolder(path?: string): Promise<ProjectsSnapshot> {
    if (!path?.trim()) {
      throw new Error("Enter an absolute project path on the remote Host.");
    }
    return this.sync(await this.host.registerProject(path.trim()));
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

  listRemoteDirectories(path: string) {
    return this.host.directories(path);
  }

  async activate(projectId: string): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.activateProject(projectId));
  }

  async updateProject(update: {
    id: string;
    pinned: boolean;
  }): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.updateProject(update));
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

  async deleteConversation(target: {
    projectId: string;
    id: string;
  }): Promise<ProjectsSnapshot> {
    return this.sync(await this.host.deleteConversation(target));
  }

  project(projectId: string): HostProjectSummary | undefined {
    return this.snapshot.projects.find(({ id }) => id === projectId);
  }

  activeProject(): HostProjectSummary | undefined {
    return this.snapshot.projects.find(
      ({ id }) => id === this.snapshot.activeProjectId,
    );
  }

  private sync(snapshot: HostProjectsSnapshot): ProjectsSnapshot {
    this.snapshot = snapshot;
    this.activateRuntime(snapshot);
    return {
      activeProjectId: snapshot.activeProjectId,
      projects: snapshot.projects.map((project) => ({
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

  private activateRuntime(snapshot: HostProjectsSnapshot): void {
    if (snapshot.activeProjectId) {
      this.transport.activateProject(snapshot.activeProjectId);
    }
  }
}

function remoteWorkspaceAdapter(
  host: HttpHostClient,
  transport: SwitchableHttpRuntimeTransport,
): WorkspaceAdapter {
  const activate = (projectId: string) =>
    transport.activateProject(projectId);
  return {
    async getChanges(projectId, threadId) {
      activate(projectId);
      const changes = await transport.workspaceChanges();
      const files = changes.files.map((file) => ({
        path: file.path,
        status:
          file.status === "added" || file.status === "untracked"
            ? ("added" as const)
            : file.status === "deleted"
              ? ("deleted" as const)
              : ("modified" as const),
        additions: file.additions,
        deletions: file.deletions,
        binary: file.binary,
        ...(file.oldText === undefined
          ? {}
          : { oldContent: file.oldText }),
        ...(file.newText === undefined
          ? {}
          : { newContent: file.newText }),
      }));
      return {
        threadId,
        additions: files.reduce(
          (total, file) => total + file.additions,
          0,
        ),
        deletions: files.reduce(
          (total, file) => total + file.deletions,
          0,
        ),
        revision: changes.revision,
        files,
      } satisfies ConversationChangesSnapshot;
    },
    async list(projectId, path) {
      activate(projectId);
      const entries = await transport.workspaceList(path);
      return entries.map((entry) => ({
        name: entry.name,
        path: entry.path,
        type: entry.kind,
      }));
    },
    async read(projectId, path) {
      activate(projectId);
      const file = await transport.workspaceFile(path);
      return {
        path: file.path,
        name: file.path.split("/").at(-1) ?? file.path,
        ...(file.binary ? {} : { content: file.content }),
        binary: file.binary,
        size: file.size,
      };
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
  options: Omit<
    ConstructorParameters<typeof BrowserTerminalClient>[0],
    "send"
  >,
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
    resize: ({ sessionId, cols, rows }) =>
      client.resize(sessionId, cols, rows),
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
        void this.receive(request);
      }),
      client.on("execution/approval-resolved", ({ requestId }) => {
        this.pending.delete(requestId);
        for (const listener of this.resolved) listener(requestId);
      }),
    ];
  }

  subscribe(
    listener: (request: ExecutionApprovalRequest) => void,
  ): () => void {
    this.requests.add(listener);
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
    if (decision === "allow" && scope === "task") {
      this.taskGrants.add(taskGrantKey(request));
    }
    if (decision === "allow" && scope === "project") {
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
    await this.client.request("execution/approval/respond", {
      requestId,
      decision,
    });
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
        grant.projectId !== projectId ||
        grant.permissionKey !== permissionKey,
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
    const project = this.projects.activeProject();
    if (!project) {
      await this.client.request("execution/approval/respond", {
        requestId: input.requestId,
        decision: "deny",
      });
      return;
    }
    const request: ExecutionApprovalRequest = {
      ...input,
      projectId: project.id,
      projectName: project.name,
    };
    if (
      this.taskGrants.has(taskGrantKey(request)) ||
      this.grants.some(
        (grant) =>
          grant.projectId === request.projectId &&
          grant.permissionKey === request.permissionKey,
      )
    ) {
      await this.client.request("execution/approval/respond", {
        requestId: request.requestId,
        decision: "allow",
      });
      return;
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

const EXECUTION_GRANTS_STORAGE_KEY =
  "threadlight:web:execution-policy:v1";

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

function isStoredExecutionGrant(
  value: unknown,
): value is StoredExecutionGrant {
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

function safeLocalStorage():
  | Pick<Storage, "getItem" | "setItem">
  | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return;
  }
}
