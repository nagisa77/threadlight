import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProjectStore } from "../src/main/project-store.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ProjectStore", () => {
  it("persists standalone tasks in a dedicated non-project scope", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-standalone-"));
    directories.push(root);
    const mapPath = join(root, "project-map.json");
    const standaloneRoot = join(root, "standalone");
    const store = new ProjectStore(mapPath, { standaloneRoot });

    const snapshot = store.activateStandalone();

    expect(snapshot).toMatchObject({
      activeProjectId: "standalone",
      projects: [
        {
          id: "standalone",
          name: "Standalone",
          scope: "standalone",
          basePath: realpathSync(standaloneRoot),
          conversations: [],
        },
      ],
    });
    expect(
      existsSync(join(standaloneRoot, ".threadlight", "conversations")),
    ).toBe(true);
    expect(
      new ProjectStore(mapPath, { standaloneRoot }).snapshot(),
    ).toMatchObject(snapshot);
  });

  it("persists the global project map and prepares project storage", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const projectPath = join(root, "sample-project");
    mkdirSync(projectPath);
    const mapPath = join(root, "home", ".threadlight", "project-map.json");
    let now = new Date("2026-07-21T08:00:00.000Z");
    const store = new ProjectStore(mapPath, {
      createId: () => "project-1",
      now: () => now,
    });

    store.register(projectPath);
    now = new Date("2026-07-21T08:01:00.000Z");
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "Persist this conversation",
    });

    expect(
      existsSync(join(projectPath, ".threadlight", "conversations")),
    ).toBe(true);
    expect(JSON.parse(readFileSync(mapPath, "utf8"))).toMatchObject({
      version: 1,
      activeProjectId: "project-1",
      projects: [
        {
          id: "project-1",
          basePath: realpathSync(projectPath),
          conversations: [
            { id: "thread-1", title: "Persist this conversation" },
          ],
        },
      ],
    });
    expect(new ProjectStore(mapPath).snapshot()).toMatchObject({
      activeProjectId: "project-1",
      projects: [{ conversations: [{ id: "thread-1" }] }],
    });
  });

  it("keeps a distinct base path for every registered project", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const first = join(root, "first");
    const second = join(root, "second");
    mkdirSync(first);
    mkdirSync(second);
    const ids = ["project-1", "project-2"];
    const store = new ProjectStore(join(root, "project-map.json"), {
      createId: () => ids.shift() ?? "unexpected",
    });

    store.register(first);
    const snapshot = store.register(second);

    expect(snapshot.activeProjectId).toBe("project-2");
    expect(snapshot.projects.map((project) => project.basePath)).toEqual([
      realpathSync(first),
      realpathSync(second),
    ]);
    expect(store.activate("project-1").activeProjectId).toBe("project-1");
  });

  it("persists project pinning and sorts pinned projects first", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-project-pins-"));
    directories.push(root);
    const first = join(root, "first");
    const second = join(root, "second");
    mkdirSync(first);
    mkdirSync(second);
    const ids = ["project-1", "project-2"];
    let now = new Date("2026-07-30T08:00:00.000Z");
    const mapPath = join(root, "project-map.json");
    const store = new ProjectStore(mapPath, {
      createId: () => ids.shift() ?? "unexpected",
      now: () => now,
    });

    store.register(first);
    store.register(second);
    now = new Date("2026-07-30T08:01:00.000Z");
    let snapshot = store.updateProject({
      id: "project-2",
      pinned: true,
    });

    expect(snapshot.projects.map(({ id }) => id)).toEqual([
      "project-2",
      "project-1",
    ]);
    expect(
      new ProjectStore(mapPath).snapshot().projects[0]?.pinnedAt,
    ).toBe("2026-07-30T08:01:00.000Z");

    snapshot = store.updateProject({
      id: "project-2",
      pinned: false,
    });
    expect(snapshot.projects.find(({ id }) => id === "project-2")?.pinnedAt)
      .toBeUndefined();
  });

  it("projects one host at a time without mixing local and remote projects", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const local = join(root, "local");
    mkdirSync(local);
    const store = new ProjectStore(join(root, "project-map.json"), {
      createId: () => "local-project",
    });
    store.register(local);

    const snapshot = store.replaceRemoteHostProjects(
      {
        hostId: "host-1",
        endpoint: "http://127.0.0.1:7432",
      },
      {
        activeProjectId: "remote-project",
        projects: [
          {
            id: "remote-project",
            name: "Large repository",
            basePath: "/workspace/large-repository",
            lastOpenedAt: "2026-07-30T08:00:00.000Z",
            conversations: [],
          },
        ],
      },
    );

    expect(snapshot).toMatchObject({
      activeProjectId: "remote-project",
      projects: [
        {
          id: "remote-project",
          name: "Large repository",
          basePath: "/workspace/large-repository",
          runtime: {
            kind: "remote",
            hostId: "host-1",
            endpoint: "http://127.0.0.1:7432",
            runtimeId: "remote-project",
          },
        },
      ],
    });
    expect(store.snapshotForHost("local").projects.map(({ id }) => id)).toEqual([
      "local-project",
    ]);
    expect(store.snapshotForHost("host-1").projects.map(({ id }) => id)).toEqual([
      "remote-project",
    ]);
    expect(store.removeRemoteHost("host-1").projects.map(({ id }) => id))
      .toEqual(["local-project"]);
    expect(store.snapshotForHost("host-1").projects).toEqual([]);
  });

  it("preserves a Desktop client's remote project selection", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const store = new ProjectStore(join(root, "project-map.json"));
    const remote = {
      activeProjectId: "host-active",
      projects: [
        {
          id: "host-active",
          name: "Host active",
          basePath: "/workspace/host-active",
          lastOpenedAt: "2026-08-02T00:00:00.000Z",
          conversations: [],
        },
        {
          id: "desktop-active",
          name: "Desktop active",
          basePath: "/workspace/desktop-active",
          lastOpenedAt: "2026-08-02T00:00:00.000Z",
          conversations: [],
        },
      ],
    };

    const snapshot = store.replaceRemoteHostProjects(
      {
        hostId: "host-1",
        endpoint: "http://127.0.0.1:7432",
        activeProjectId: "desktop-active",
      },
      remote,
    );

    expect(snapshot.activeProjectId).toBe("desktop-active");
  });

  it("requires archiving before permanently removing a task", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const projectPath = join(root, "sample-project");
    mkdirSync(projectPath);
    const store = new ProjectStore(join(root, "project-map.json"), {
      createId: () => "project-1",
    });
    store.register(projectPath);
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "Delete me",
    });
    const conversationPath = join(
      projectPath,
      ".threadlight",
      "conversations",
      "thread-1.json",
    );
    writeFileSync(conversationPath, "{}\n");

    expect(() =>
      store.deleteConversation({
        projectId: "project-1",
        id: "thread-1",
      }),
    ).toThrow("Archive");
    store.updateConversation({
      projectId: "project-1",
      id: "thread-1",
      archived: true,
    });
    const snapshot = store.deleteConversation({
      projectId: "project-1",
      id: "thread-1",
    });

    expect(snapshot.projects[0].conversations).toEqual([]);
    expect(existsSync(conversationPath)).toBe(false);
    expect(new ProjectStore(join(root, "project-map.json")).snapshot()
      .projects[0].conversations).toEqual([]);
  });

  it("persists completion unread state until the task is opened", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const projectPath = join(root, "sample-project");
    mkdirSync(projectPath);
    const mapPath = join(root, "project-map.json");
    const store = new ProjectStore(mapPath, {
      createId: () => "project-1",
    });
    store.register(projectPath);
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "Background task",
    });

    expect(
      store.markConversationUnread({
        projectId: "project-1",
        id: "thread-1",
      }).projects[0]?.conversations[0]?.unread,
    ).toBe(true);
    expect(
      new ProjectStore(mapPath).snapshot().projects[0]?.conversations[0]
        ?.unread,
    ).toBe(true);
    expect(
      store.markConversationRead({
        projectId: "project-1",
        id: "thread-1",
      }).projects[0]?.conversations[0]?.unread,
    ).toBe(false);
  });

  it("applies a generated title once and never overwrites a manual rename", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const projectPath = join(root, "sample-project");
    mkdirSync(projectPath);
    const mapPath = join(root, "project-map.json");
    let now = new Date("2026-07-29T08:00:00.000Z");
    const store = new ProjectStore(mapPath, {
      createId: () => "project-1",
      now: () => now,
    });
    store.register(projectPath);
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "新任务",
    });

    now = new Date("2026-07-29T08:01:00.000Z");
    let snapshot = store.setGeneratedConversationTitle(
      { projectId: "project-1", id: "thread-1" },
      "修复运行时离线",
    );
    expect(snapshot.projects[0]?.conversations[0]).toMatchObject({
      title: "修复运行时离线",
      titleGeneratedAt: "2026-07-29T08:01:00.000Z",
    });

    store.setGeneratedConversationTitle(
      { projectId: "project-1", id: "thread-1" },
      "不应覆盖的第二个标题",
    );
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "也不应覆盖的首条消息",
    });
    now = new Date("2026-07-29T08:02:00.000Z");
    store.updateConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "我的手动标题",
    });
    snapshot = store.setGeneratedConversationTitle(
      { projectId: "project-1", id: "thread-1" },
      "更晚的模型标题",
    );

    expect(snapshot.projects[0]?.conversations[0]).toMatchObject({
      title: "我的手动标题",
      renamedAt: "2026-07-29T08:02:00.000Z",
      titleGeneratedAt: "2026-07-29T08:01:00.000Z",
    });

    store.upsertConversation({
      projectId: "project-1",
      id: "thread-2",
      title: "新任务",
    });
    store.updateConversation({
      projectId: "project-1",
      id: "thread-2",
      title: "先手动命名",
    });
    snapshot = store.setGeneratedConversationTitle(
      { projectId: "project-1", id: "thread-2" },
      "模型不应覆盖",
    );
    expect(snapshot.projects[0]?.conversations).toContainEqual(
      expect.objectContaining({
        id: "thread-2",
        title: "先手动命名",
        renamedAt: "2026-07-29T08:02:00.000Z",
      }),
    );
  });

  it("persists lifecycle, rename, pin, and archive metadata", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const projectPath = join(root, "sample-project");
    mkdirSync(projectPath);
    const mapPath = join(root, "project-map.json");
    let now = new Date("2026-07-29T08:00:00.000Z");
    const store = new ProjectStore(mapPath, {
      createId: () => "project-1",
      now: () => now,
    });
    store.register(projectPath);
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "Draft task",
    });

    expect(store.snapshot().projects[0]?.conversations[0]?.status).toBe(
      "pending",
    );
    store.markConversationCompleted({
      projectId: "project-1",
      id: "thread-1",
    });
    now = new Date("2026-07-29T08:01:00.000Z");
    store.updateConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "Renamed task",
      pinned: true,
    });
    expect(store.snapshot().projects[0]?.conversations[0]).toMatchObject({
      title: "Renamed task",
      status: "completed",
      renamedAt: "2026-07-29T08:01:00.000Z",
      pinnedAt: "2026-07-29T08:01:00.000Z",
    });
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "Generated replacement",
    });
    expect(store.snapshot().projects[0]?.conversations[0]?.title).toBe(
      "Renamed task",
    );

    now = new Date("2026-07-29T08:02:00.000Z");
    store.updateConversation({
      projectId: "project-1",
      id: "thread-1",
      archived: true,
    });
    expect(new ProjectStore(mapPath).snapshot()
      .projects[0]?.conversations[0]).toMatchObject({
      title: "Renamed task",
      status: "completed",
      archivedAt: "2026-07-29T08:02:00.000Z",
    });
    expect(
      new ProjectStore(mapPath).snapshot().projects[0]?.conversations[0]
        ?.pinnedAt,
    ).toBeUndefined();
    expect(JSON.parse(readFileSync(mapPath, "utf8"))).toMatchObject({
      projects: [
        {
          conversations: [
            {
              title: "Renamed task",
              status: "completed",
              renamedAt: "2026-07-29T08:01:00.000Z",
              archivedAt: "2026-07-29T08:02:00.000Z",
            },
          ],
        },
      ],
    });
  });

  it("treats legacy task records without a status as completed", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const projectPath = join(root, "sample-project");
    mkdirSync(projectPath);
    const mapPath = join(root, "project-map.json");
    writeFileSync(
      mapPath,
      `${JSON.stringify({
        version: 1,
        activeProjectId: "project-1",
        projects: [
          {
            id: "project-1",
            name: "sample-project",
            basePath: realpathSync(projectPath),
            lastOpenedAt: "2026-07-29T00:00:00.000Z",
            conversations: [
              {
                id: "legacy-thread",
                title: "Legacy",
                createdAt: "2026-07-29T00:00:00.000Z",
                updatedAt: "2026-07-29T00:00:00.000Z",
              },
            ],
          },
        ],
      })}\n`,
    );
    const store = new ProjectStore(mapPath, {
      now: () => new Date("2026-07-29T01:00:00.000Z"),
    });

    expect(store.snapshot().projects[0]?.conversations[0]?.status).toBe(
      "completed",
    );
    store.updateConversation({
      projectId: "project-1",
      id: "legacy-thread",
      pinned: true,
    });
    expect(
      JSON.parse(readFileSync(mapPath, "utf8")).projects[0].conversations[0]
        .status,
    ).toBe("completed");
  });

  it("sorts pinned tasks before recent unpinned tasks", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const projectPath = join(root, "sample-project");
    mkdirSync(projectPath);
    let now = new Date("2026-07-29T08:00:00.000Z");
    const store = new ProjectStore(join(root, "project-map.json"), {
      createId: () => "project-1",
      now: () => now,
    });
    store.register(projectPath);
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-pinned",
      title: "Pinned",
    });
    store.updateConversation({
      projectId: "project-1",
      id: "thread-pinned",
      pinned: true,
    });
    now = new Date("2026-07-29T09:00:00.000Z");
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-recent",
      title: "Recent",
    });

    expect(
      store.snapshot().projects[0]?.conversations.map(({ id }) => id),
    ).toEqual(["thread-pinned", "thread-recent"]);
  });

  it("persists conversation-level full access without changing the project default", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const projectPath = join(root, "sample-project");
    mkdirSync(projectPath);
    const mapPath = join(root, "project-map.json");
    const store = new ProjectStore(mapPath, {
      createId: () => "project-1",
    });
    store.register(projectPath);
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-full",
      title: "Trusted task",
    });
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-approval",
      title: "Guarded task",
    });

    store.updateConversation({
      projectId: "project-1",
      id: "thread-full",
      accessMode: "full",
    });

    const conversations =
      new ProjectStore(mapPath).snapshot().projects[0]?.conversations;
    expect(
      conversations?.find(({ id }) => id === "thread-full"),
    ).toMatchObject({ accessMode: "full" });
    expect(
      conversations?.find(({ id }) => id === "thread-approval")?.accessMode,
    ).toBeUndefined();
  });

  it("persists the isolated workspace before the task is named", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const projectPath = join(root, "sample-project");
    const worktreePath = join(root, "task-worktree");
    mkdirSync(projectPath);
    mkdirSync(worktreePath);
    const mapPath = join(root, "project-map.json");
    const store = new ProjectStore(mapPath, {
      createId: () => "project-1",
    });
    store.register(projectPath);

    store.setConversationWorkspace(
      { projectId: "project-1", id: "thread-1" },
      {
        mode: "worktree",
        path: worktreePath,
        root: worktreePath,
        repositoryRoot: projectPath,
        branch: "threadlight/sample-123",
        baseCommit: "abc123",
      },
    );
    store.upsertConversation({
      projectId: "project-1",
      id: "thread-1",
      title: "Isolated task",
    });

    expect(
      new ProjectStore(mapPath).snapshot().projects[0]?.conversations[0],
    ).toMatchObject({
      id: "thread-1",
      title: "Isolated task",
      workspace: {
        mode: "worktree",
        path: worktreePath,
        branch: "threadlight/sample-123",
      },
    });
  });

});
