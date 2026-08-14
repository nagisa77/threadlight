import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HostDirectoryEntry } from "@threadlight/protocol";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../src/i18n.js";
import {
  filterRemoteDirectories,
  isRemoteAbsolutePath,
  loadRemoteFolderFavorites,
  pushRemoteDirectoryHistory,
  remoteDirectoryBreadcrumbs,
  remotePathsEqual,
  RemoteProjectPathDialog,
  saveRemoteFolderFavorites,
  visibleRemoteDirectories,
} from "../src/features/navigation/remote-project-picker.js";

const directories = [
  { name: ".config", path: "/Users/tim/.config" },
  { name: "Projects", path: "/Users/tim/Projects" },
  { name: "product-site", path: "/Users/tim/product-site" },
] satisfies readonly HostDirectoryEntry[];

describe("RemoteProjectPathDialog", () => {
  it("renders a complete remote folder browser instead of path completion", () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { language: "zh-CN" },
        createElement(RemoteProjectPathDialog, {
          busy: false,
          hostId: "host-1",
          hostName: "Build Mac",
          recentProjects: [
            {
              name: "threadlight",
              path: "/Users/tim/threadlight",
              lastOpenedAt: "2026-08-14T08:00:00.000Z",
            },
          ],
          onBrowse: async () => ({ path: "/Users/tim", directories }),
          onCancel: () => {},
          onOpen: () => {},
        }),
      ),
    );

    expect(html).toContain("选择远端项目文件夹");
    expect(html).toContain("Build Mac");
    expect(html).toContain('class="remote-project-picker-sidebar"');
    expect(html).toContain('class="remote-picker-breadcrumbs"');
    expect(html).toContain('placeholder="搜索当前文件夹"');
    expect(html).toContain("显示隐藏项");
    expect(html).toContain("最近项目");
    expect(html).toContain("threadlight");
    expect(html).toContain('role="listbox"');
  });

  it("hides dot-directories unless typing a dot or toggling hidden items", () => {
    expect(visibleRemoteDirectories("/Users/tim/", directories)).toEqual([
      directories[1],
      directories[2],
    ]);
    expect(visibleRemoteDirectories("/Users/tim/.", directories)).toEqual(
      directories,
    );
    expect(visibleRemoteDirectories("/Users/tim/", directories, true)).toEqual(
      directories,
    );
    expect(
      visibleRemoteDirectories("/Users/tim/.config/", directories),
    ).toEqual([directories[1], directories[2]]);
  });

  it("filters folders case-insensitively without reordering them", () => {
    expect(filterRemoteDirectories(directories, "PRO")).toEqual([
      directories[1],
      directories[2],
    ]);
    expect(filterRemoteDirectories(directories, "  ")).toBe(directories);
  });

  it("builds clickable breadcrumbs for POSIX and Windows paths", () => {
    expect(remoteDirectoryBreadcrumbs("/Users/tim/Projects")).toEqual([
      { label: "/", path: "/" },
      { label: "Users", path: "/Users" },
      { label: "tim", path: "/Users/tim" },
      { label: "Projects", path: "/Users/tim/Projects" },
    ]);
    expect(remoteDirectoryBreadcrumbs("C:\\Users\\tim\\Projects")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "tim", path: "C:\\Users\\tim" },
      { label: "Projects", path: "C:\\Users\\tim\\Projects" },
    ]);
    expect(remotePathsEqual("C:\\Users\\TIM\\", "c:/users/tim")).toBe(true);
    expect(
      remotePathsEqual(
        "\\\\SERVER\\Share\\Folder",
        "\\\\server\\share\\folder\\",
      ),
    ).toBe(true);
    expect(remotePathsEqual("/", "")).toBe(false);
  });

  it("recognizes remote absolute paths and trims forward history", () => {
    expect(isRemoteAbsolutePath("~")).toBe(true);
    expect(isRemoteAbsolutePath("/srv/projects")).toBe(true);
    expect(isRemoteAbsolutePath("D:\\work")).toBe(true);
    expect(isRemoteAbsolutePath("relative/project")).toBe(false);

    expect(
      pushRemoteDirectoryHistory(
        { paths: ["/", "/Users", "/Users/tim"], index: 1 },
        "/srv",
      ),
    ).toEqual({ paths: ["/", "/Users", "/srv"], index: 2 });
  });

  it("persists valid favorites per Host and tolerates broken storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    saveRemoteFolderFavorites("host-1", ["/srv/app"], storage);
    expect(loadRemoteFolderFavorites("host-1", storage)).toEqual(["/srv/app"]);
    expect(loadRemoteFolderFavorites("host-2", storage)).toEqual([]);

    values.set("threadlight:remote-folder-favorites:v1:host-1", "broken");
    expect(loadRemoteFolderFavorites("host-1", storage)).toEqual([]);
  });
});
