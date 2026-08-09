import {
  AgentLoop,
  AgentOrchestrator,
  defineAgent,
  type ModelProvider,
} from "@threadlight/agent-loop";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BUILTIN_SUBAGENT_PROFILES,
  loadSubagentProfiles,
} from "../src/agent-profile-loader.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("loadSubagentProfiles", () => {
  it("provides default, worker, and explorer when no TOML directories exist", async () => {
    const root = await temporaryRoot();
    const profiles = await loadSubagentProfiles({
      personalDirectory: join(root, "missing-personal"),
      projectDirectory: join(root, "missing-project"),
    });

    expect(BUILTIN_SUBAGENT_PROFILES.map(({ name }) => name)).toEqual([
      "default",
      "worker",
      "explorer",
    ]);
    expect(profiles.map(({ name }) => name)).toEqual([
      "default",
      "worker",
      "explorer",
    ]);
    expect(profiles.find(({ name }) => name === "worker")).toMatchObject({
      toolAccess: "all",
      excludedTools: expect.arrayContaining(["project_memory"]),
    });
  });

  it("merges project profiles over personal profiles over built-ins", async () => {
    const root = await temporaryRoot();
    const personal = join(root, "personal");
    const project = join(root, "project");
    await mkdir(personal);
    await mkdir(project);
    await writeFile(
      join(personal, "explorer.toml"),
      ['description = "Personal explorer"', "max_steps = 6"].join("\n"),
    );
    await writeFile(
      join(personal, "security-audit.toml"),
      [
        'description = "Audit repository security"',
        'instructions = """',
        "Trace trust boundaries and report concrete vulnerabilities.",
        '"""',
        'tool_access = "read-only"',
        'excluded_tools = ["exec_command"]',
        'model = "security-model"',
        'provider = "custom-provider"',
        "max_steps = 9",
      ].join("\n"),
    );
    await writeFile(
      join(project, "browser-debug.toml"),
      [
        'description = "Debug browser behavior"',
        'instructions = "Reproduce the delegated browser issue and report evidence."',
        'tool_access = "all"',
      ].join("\n"),
    );
    await writeFile(
      join(project, "security-audit.toml"),
      [
        'instructions = "Audit this repository policy before reporting findings."',
        'tool_access = "all"',
        'excluded_tools = ["project_memory"]',
      ].join("\n"),
    );

    const profiles = await loadSubagentProfiles({
      personalDirectory: personal,
      projectDirectory: project,
    });

    expect(profiles.map(({ name }) => name)).toEqual([
      "default",
      "worker",
      "explorer",
      "security-audit",
      "browser-debug",
    ]);
    expect(profiles.find(({ name }) => name === "explorer")).toMatchObject({
      description: "Personal explorer",
      maxSteps: 6,
      toolAccess: "read-only",
    });
    expect(profiles.find(({ name }) => name === "security-audit")).toEqual({
      name: "security-audit",
      description: "Audit repository security",
      instructions: "Audit this repository policy before reporting findings.",
      toolAccess: "all",
      excludedTools: ["project_memory"],
      model: "security-model",
      provider: "custom-provider",
      maxSteps: 9,
    });
    expect(profiles.find(({ name }) => name === "browser-debug")).toMatchObject(
      {
        toolAccess: "all",
      },
    );
  });

  it("rejects unknown fields, incomplete new roles, and duplicate names", async () => {
    const root = await temporaryRoot();
    const unknown = join(root, "unknown");
    await mkdir(unknown);
    await writeFile(
      join(unknown, "audit.toml"),
      [
        'description = "Audit"',
        'instructions = "Inspect"',
        'tool_acess = "all"',
      ].join("\n"),
    );
    await expect(
      loadSubagentProfiles({ personalDirectory: unknown }),
    ).rejects.toThrow(/unknown field tool_acess/);

    const incomplete = join(root, "incomplete");
    await mkdir(incomplete);
    await writeFile(
      join(incomplete, "research.toml"),
      'description = "Research documentation"',
    );
    await expect(
      loadSubagentProfiles({ personalDirectory: incomplete }),
    ).rejects.toThrow(/instructions must be a non-empty string/);

    const duplicate = join(root, "duplicate");
    await mkdir(duplicate);
    await writeFile(
      join(duplicate, "one.toml"),
      [
        'name = "audit"',
        'description = "Audit one"',
        'instructions = "Inspect one"',
      ].join("\n"),
    );
    await writeFile(
      join(duplicate, "two.toml"),
      [
        'name = "audit"',
        'description = "Audit two"',
        'instructions = "Inspect two"',
      ].join("\n"),
    );
    await expect(
      loadSubagentProfiles({ projectDirectory: duplicate }),
    ).rejects.toThrow(/Duplicate project agent profile audit/);
  });

  it("advertises and runs a project-defined role with a scripted provider", async () => {
    const root = await temporaryRoot();
    const project = join(root, "project");
    await mkdir(project);
    await writeFile(
      join(project, "security-audit.toml"),
      [
        'description = "Audit repository security"',
        'instructions = "Inspect trust boundaries and return findings."',
        'tool_access = "read-only"',
      ].join("\n"),
    );
    const profiles = await loadSubagentProfiles({
      projectDirectory: project,
    });
    let rootTurns = 0;
    const provider: ModelProvider = {
      async generate(request) {
        if (request.instructions.includes("SUBAGENT ROLE")) {
          expect(request.instructions).toContain(
            "Inspect trust boundaries and return findings.",
          );
          return { text: "No security finding.", toolCalls: [] };
        }
        rootTurns += 1;
        if (rootTurns === 1) {
          const spawn = request.tools.find(
            ({ name }) => name === "spawn_agent",
          );
          expect(
            (
              spawn?.parameters.properties?.role as
                { enum?: readonly string[] } | undefined
            )?.enum,
          ).toContain("security-audit");
          return {
            text: "Delegating the audit.",
            toolCalls: [
              {
                id: "spawn-security",
                name: "spawn_agent",
                arguments: {
                  role: "security-audit",
                  task: "Audit the repository",
                },
              },
            ],
          };
        }
        if (rootTurns === 2) {
          return {
            text: "Collecting the audit.",
            toolCalls: [
              { id: "wait-security", name: "wait_for_agents", arguments: {} },
            ],
          };
        }
        expect(request.toolResults?.[0]?.output).toContain(
          "No security finding",
        );
        return { text: "Security audit complete.", toolCalls: [] };
      },
    };
    const orchestrator = new AgentOrchestrator(new AgentLoop(provider), {
      profiles,
    });

    const result = await orchestrator.run(
      defineAgent({ name: "root", instructions: "ROOT" }),
      "Audit",
    );

    expect(result.output).toBe("Security audit complete.");
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "threadlight-agent-profiles-"));
  temporaryRoots.push(root);
  return root;
}
