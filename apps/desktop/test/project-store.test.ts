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

  it("removes a task from its project map", () => {
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

    const snapshot = store.deleteConversation({
      projectId: "project-1",
      id: "thread-1",
    });

    expect(snapshot.projects[0].conversations).toEqual([]);
    expect(existsSync(conversationPath)).toBe(false);
    expect(new ProjectStore(join(root, "project-map.json")).snapshot()
      .projects[0].conversations).toEqual([]);
  });

  it("migrates the legacy conversation map to the project map", () => {
    const root = mkdtempSync(join(tmpdir(), "threadlight-projects-"));
    directories.push(root);
    const legacyPath = join(root, "conversation-map.json");
    const mapPath = join(root, "project-map.json");
    writeFileSync(
      legacyPath,
      `${JSON.stringify({ version: 1, projects: [] })}\n`,
    );

    const snapshot = new ProjectStore(mapPath, { legacyPath }).snapshot();

    expect(snapshot.projects).toEqual([]);
    expect(existsSync(mapPath)).toBe(true);
    expect(existsSync(legacyPath)).toBe(false);
  });
});
