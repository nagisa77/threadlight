import type { HostDirectoryEntry } from "@threadlight/protocol";
import { describe, expect, it } from "vitest";

import { visibleRemoteDirectories } from "../src/features/navigation/project-dialogs.js";

const directories = [
  { name: ".config", path: "/Users/tim/.config" },
  { name: "projects", path: "/Users/tim/projects" },
] satisfies readonly HostDirectoryEntry[];

describe("remote project directory suggestions", () => {
  it("hides dot-directories until the current path segment starts with a dot", () => {
    expect(visibleRemoteDirectories("/Users/tim/", directories)).toEqual([
      directories[1],
    ]);
    expect(visibleRemoteDirectories("/Users/tim/.", directories)).toEqual(
      directories,
    );
  });

  it("hides dot-directories again after entering a hidden parent", () => {
    expect(
      visibleRemoteDirectories("/Users/tim/.config/", directories),
    ).toEqual([directories[1]]);
  });

  it("supports Windows-style remote paths", () => {
    expect(visibleRemoteDirectories("C:\\Users\\tim\\.", directories)).toEqual(
      directories,
    );
  });
});
