import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SkillsOnlyPluginRegistry } from "../src/plugin-registry.js";
import { createSkillPluginThreadRuntime } from "../src/thread-extensions.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("skills-only plugins", () => {
  it("loads plugin skills with a plugin namespace", async () => {
    const root = temporaryDirectory("threadlight-plugin-");
    writePlugin(root, {
      name: "release-tools",
      version: "1.2.0",
      description: "Reusable release workflows.",
      skillName: "prepare-release",
      skillDescription: "Prepare a release when the user asks to ship a build.",
      instructions: "Run release validation and summarize blockers.",
    });

    const plugins = await SkillsOnlyPluginRegistry.discover({ roots: [root] });
    expect(plugins.plugins).toMatchObject([
      {
        name: "release-tools",
        version: "1.2.0",
      },
    ]);
    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [],
      repoSkillRoots: [],
      userSkillRoots: [],
      pluginRoots: [root],
    });

    expect(runtime.snapshot.skills.skills).toMatchObject([
      {
        name: "prepare-release",
        invocationName: "release-tools:prepare-release",
        scope: "plugin",
        plugin: {
          name: "release-tools",
          version: "1.2.0",
        },
      },
    ]);
    expect(runtime.promptBlocks.map((block) => block.content).join("\n"))
      .toContain("$release-tools:prepare-release");
    expect(
      runtime.promptBlocksForTurn(
        "Use $release-tools:prepare-release for this build.",
      )[0]?.content,
    ).toContain("Run release validation");
  });

  it("rejects plugins that declare executable or connected capabilities", async () => {
    const root = temporaryDirectory("threadlight-plugin-invalid-");
    const pluginRoot = writePlugin(root, {
      name: "connected-plugin",
      version: "1.0.0",
      description: "Not skills-only.",
      skillName: "connected-workflow",
      skillDescription: "Use a connected workflow.",
      instructions: "Call a connector.",
    });
    const manifestPath = join(pluginRoot, ".codex-plugin", "plugin.json");
    const manifest = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as Record<string, unknown>;
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, mcpServers: "./.mcp.json" }, null, 2)}\n`,
    );

    const registry = await SkillsOnlyPluginRegistry.discover({ roots: [root] });
    expect(registry.plugins).toEqual([]);
    expect(registry.warnings.join("\n")).toContain(
      "currently accepts skills-only plugins",
    );
  });
});

function writePlugin(
  root: string,
  options: {
    name: string;
    version: string;
    description: string;
    skillName: string;
    skillDescription: string;
    instructions: string;
  },
): string {
  const pluginRoot = join(root, options.name);
  const manifestDirectory = join(pluginRoot, ".codex-plugin");
  const skillDirectory = join(pluginRoot, "skills", options.skillName);
  mkdirSync(manifestDirectory, { recursive: true });
  mkdirSync(skillDirectory, { recursive: true });
  writeFileSync(
    join(manifestDirectory, "plugin.json"),
    `${JSON.stringify(
      {
        name: options.name,
        version: options.version,
        description: options.description,
        skills: "./skills/",
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(skillDirectory, "SKILL.md"),
    [
      "---",
      `name: ${options.skillName}`,
      `description: ${JSON.stringify(options.skillDescription)}`,
      "---",
      "",
      options.instructions,
      "",
    ].join("\n"),
  );
  return pluginRoot;
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}
