import { describe, expect, it, vi } from "vitest";

import {
  openProjectWith,
  projectOpeners,
} from "../src/main/project-opener.js";

describe("project opener", () => {
  it("uses Launch Services results instead of a fixed application catalog", async () => {
    const runScript = vi.fn(async () =>
      JSON.stringify([
        {
          id: "com.apple.finder",
          label: "Finder",
          applicationPath: "/System/Library/CoreServices/Finder.app",
          iconPath:
            "/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns",
          default: true,
        },
        {
          id: "com.example.editor",
          label: "Installed Editor",
          applicationPath: "/Applications/Installed Editor.app",
          iconPath:
            "/Applications/Installed Editor.app/Contents/Resources/Editor.icns",
          default: false,
        },
      ]),
    );

    await expect(
      projectOpeners("/workspace/project", {
        platform: "darwin",
        runScript,
      }),
    ).resolves.toEqual([
      {
        id: "com.apple.finder",
        label: "Finder",
        applicationPath: "/System/Library/CoreServices/Finder.app",
        iconPath:
          "/System/Library/CoreServices/Finder.app/Contents/Resources/Finder.icns",
        available: true,
        default: true,
      },
      {
        id: "com.example.editor",
        label: "Installed Editor",
        applicationPath: "/Applications/Installed Editor.app",
        iconPath:
          "/Applications/Installed Editor.app/Contents/Resources/Editor.icns",
        available: true,
        default: false,
      },
    ]);
    expect(runScript).toHaveBeenCalledWith(
      "/usr/bin/osascript",
      expect.arrayContaining(["/workspace/project"]),
    );
  });

  it("opens a project by discovered bundle id with an opaque path argument", async () => {
    const runApplication = vi.fn(async () => {});

    await openProjectWith(
      "/workspace/Project $(safe)",
      "com.example.editor",
      {
        platform: "darwin",
        runApplication,
      },
    );

    expect(runApplication).toHaveBeenCalledWith("/usr/bin/open", [
      "-b",
      "com.example.editor",
      "/workspace/Project $(safe)",
    ]);
  });

  it("uses the system folder opener outside macOS", async () => {
    const openPath = vi.fn(async () => "");

    await openProjectWith("/workspace/project", "system", {
      platform: "linux",
      openPath,
    });

    expect(openPath).toHaveBeenCalledWith("/workspace/project");
  });
});
