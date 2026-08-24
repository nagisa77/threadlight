import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";
import { afterEach, describe, expect, it } from "vitest";

import { AppServer } from "../src/app-server.js";
import { createSkill } from "../src/skill-creator.js";
import { SkillRegistry } from "../src/skill-registry.js";
import {
  createSkillPluginThreadRuntime,
  defaultBuiltinSkillRoot,
} from "../src/thread-extensions.js";
import type { JsonRpcOutgoing } from "../src/protocol.js";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Skill Registry", () => {
  it("discovers metadata, restores frozen contents, and creates skills atomically", async () => {
    const root = temporaryDirectory("threadlight-skill-registry-");
    const repoSkills = join(root, ".agents", "skills");
    writeSkill(
      repoSkills,
      "review-code",
      "Review code when the user asks for a focused correctness review.",
      "Inspect changed files and report only actionable findings.",
    );
    const registry = await SkillRegistry.discover({
      sources: [{ scope: "repo", root: repoSkills }],
    });

    expect(registry.descriptors()).toMatchObject([
      {
        name: "review-code",
        invocationName: "review-code",
        scope: "repo",
      },
    ]);
    expect(registry.catalogPrompt()).toContain("$review-code");
    expect(registry.read("review-code").instructions).toContain(
      "report only actionable findings",
    );

    const snapshot = registry.snapshot();
    writeSkill(
      repoSkills,
      "review-code",
      "Changed description.",
      "Changed instructions.",
    );
    const restored = SkillRegistry.fromSnapshot(snapshot);
    expect(restored.read("review-code").instructions).toContain(
      "report only actionable findings",
    );
    expect(restored.read("review-code").instructions).not.toContain(
      "Changed instructions",
    );
    expect(() =>
      SkillRegistry.fromSnapshot({
        ...snapshot,
        skills: snapshot.skills.map((skill) => ({
          ...skill,
          resources: [join(root, "outside.txt")],
        })),
      }),
    ).toThrow("invalid resource");

    const created = await createSkill(
      {
        project: repoSkills,
        user: join(root, "user-skills"),
      },
      {
        scope: "project",
        name: "release-check",
        description:
          "Check a release when the user asks whether a build is ready to ship.",
        instructions:
          "Run the offline checks. Report failures before declaring the release ready.",
      },
    );
    expect(readFileSync(created.skillFile, "utf8")).toContain(
      "name: release-check",
    );
    await expect(
      createSkill(
        {
          project: repoSkills,
          user: join(root, "user-skills"),
        },
        {
          scope: "project",
          name: "release-check",
          description: "Duplicate.",
          instructions: "Duplicate.",
        },
      ),
    ).rejects.toThrow("already exists");
  });

  it("discovers role entry points and loads a focused skill capsule", async () => {
    const root = temporaryDirectory("threadlight-skill-capsule-");
    const skills = join(root, "skills");
    writeSkill(
      skills,
      "harness",
      "Coordinate a large implementation workflow.",
      "SHARED_MAIN_INSTRUCTIONS_THAT_A_LEAF_SHOULD_NOT_RECEIVE",
    );
    const skillRoot = join(skills, "harness");
    mkdirSync(join(skillRoot, "agents"), { recursive: true });
    mkdirSync(join(skillRoot, "references"), { recursive: true });
    writeFileSync(
      join(skillRoot, "agents", "explorer.md"),
      "EXPLORE_ONLY: inspect evidence and return a concise finding.",
    );
    writeFileSync(
      join(skillRoot, "agents", "reviewer.md"),
      "REVIEW_ONLY: challenge the proposed result.",
    );
    writeFileSync(
      join(skillRoot, "references", "contract.md"),
      "Shared contract",
    );

    const registry = await SkillRegistry.discover({
      sources: [{ scope: "repo", root: skills }],
    });
    expect(registry.descriptors()[0]).toMatchObject({
      invocationName: "harness",
      roles: ["explorer", "reviewer"],
    });

    const capsule = await registry.capsule("harness", "explorer");
    expect(capsule.instructions).toContain("EXPLORE_ONLY");
    expect(capsule.instructions).not.toContain("SHARED_MAIN_INSTRUCTIONS");
    expect(capsule.instructions).not.toContain("REVIEW_ONLY");
    expect(capsule.resources).toEqual([
      realpathSync(join(skillRoot, "references", "contract.md")),
    ]);
    await expect(registry.capsule("harness", "writer")).rejects.toThrow(
      "available roles: explorer, reviewer",
    );

    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      builtinSkillRoots: [],
      repoSkillRoots: [skills],
      userSkillRoots: [],
      pluginRoots: [],
    });
    expect(runtime.tools.map(({ name }) => name)).toContain("skill_capsule");
  });

  it("keeps catalog entries whole, prioritizes plugin skills, and pages omitted skills", async () => {
    const root = temporaryDirectory("threadlight-skill-catalog-");
    const userSkills = join(root, "user-skills");
    const gmailSkills = join(root, "gmail-skills");
    for (let index = 0; index < 6; index += 1) {
      writeSkill(
        userSkills,
        `verbose-${index}`,
        `User workflow ${index} ${"detail ".repeat(40)}`,
        `USER_WORKFLOW_${index}`,
      );
    }
    writeSkill(
      gmailSkills,
      "gmail",
      "Search and read Gmail messages.",
      "GMAIL_WORKFLOW",
    );
    const registry = await SkillRegistry.discover({
      sources: [
        { scope: "user", root: userSkills },
        {
          scope: "plugin",
          root: gmailSkills,
          namespace: "gmail",
          plugin: { name: "gmail", version: "1.0.0" },
        },
      ],
      maxCatalogChars: 700,
    });

    const catalog = registry.catalogPrompt();
    expect(catalog).toContain("$gmail:gmail: Search and read Gmail messages.");
    expect(catalog).not.toMatch(/detail deta$/);
    expect(registry.read("gmail").instructions).toContain("GMAIL_WORKFLOW");
    expect(registry.list({ query: "verbose", limit: 2 })).toMatchObject({
      skills: [
        { invocationName: "verbose-0" },
        { invocationName: "verbose-1" },
      ],
      nextCursor: "2",
    });
    expect(
      registry.list({ query: "verbose", limit: 2, cursor: "2" }).skills,
    ).toMatchObject([
      { invocationName: "verbose-2" },
      { invocationName: "verbose-3" },
    ]);
  });

  it("rejects ambiguous short skill names with actionable invocation names", async () => {
    const root = temporaryDirectory("threadlight-skill-alias-");
    const sharedSkills = join(root, "shared-skills");
    writeSkill(sharedSkills, "gmail", "Work with mail.", "MAIL_WORKFLOW");
    const registry = await SkillRegistry.discover({
      sources: [
        { scope: "plugin", root: sharedSkills, namespace: "gmail" },
        { scope: "plugin", root: sharedSkills, namespace: "workspace-mail" },
      ],
    });

    expect(() => registry.read("gmail")).toThrow(
      "gmail:gmail, workspace-mail:gmail",
    );
  });

  it("injects explicit skills and loads implicitly matched skills through skill_read", async () => {
    const root = temporaryDirectory("threadlight-skill-runtime-");
    const repoSkills = join(root, ".agents", "skills");
    writeSkill(
      repoSkills,
      "review-code",
      "Review code when the user asks for a correctness review.",
      "REVIEW_WORKFLOW: inspect the diff and return actionable findings.",
    );
    const requests: ModelRequest[] = [];
    const provider = scriptedSkillProvider(requests);
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "skills", instructions: "Base prompt." }),
      threadRuntimeFactory: (snapshot) =>
        createSkillPluginThreadRuntime(
          {
            workspaceRoot: root,
            userHome: join(root, "home"),
            builtinSkillRoots: [],
            repoSkillRoots: [repoSkills],
            userSkillRoots: [],
            pluginRoots: [],
          },
          snapshot,
        ),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const explicitThread = result<{ threadId: string }>(messages, 2).threadId;
    await runTurn(
      server,
      messages,
      explicitThread,
      3,
      "Use $review-code on this change.",
    );
    expect(requests[0]?.instructions).toContain("Required skill read");
    expect(requests[0]?.instructions).not.toContain("REVIEW_WORKFLOW");
    expect(requests[0]?.toolResults).toEqual([]);
    expect(requests[1]?.toolResults?.[0]?.name).toBe("skill_read");
    expect(requests[1]?.toolResults?.[0]?.output).toContain("REVIEW_WORKFLOW");

    await server.receive({ jsonrpc: "2.0", id: 4, method: "thread/start" });
    const implicitThread = result<{ threadId: string }>(messages, 4).threadId;
    await runTurn(
      server,
      messages,
      implicitThread,
      5,
      "Please perform a correctness review.",
    );
    expect(requests[2]?.instructions).toContain("call skill_read");
    expect(requests[2]?.instructions).not.toContain("REVIEW_WORKFLOW");
    expect(requests[3]?.toolResults?.[0]?.name).toBe("skill_read");
    expect(requests[3]?.toolResults?.[0]?.output).toContain("REVIEW_WORKFLOW");
  });

  it("rejects completion until an explicit skill is read through skill_read", async () => {
    const root = temporaryDirectory("threadlight-skill-required-");
    const repoSkills = join(root, ".agents", "skills");
    writeSkill(
      repoSkills,
      "review-code",
      "Review code when the user asks for a correctness review.",
      "REVIEW_WORKFLOW: inspect the diff and return actionable findings.",
    );
    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          // Premature completion: rejected by SkillReadRequirementController.
          return { text: "Done.", toolCalls: [] };
        }
        if (requests.length === 2) {
          return {
            text: "I'll load the requested skill.",
            toolCalls: [
              {
                id: "skill-read-required",
                name: "skill_read",
                arguments: { skill: "review-code" },
              },
            ],
          };
        }
        return { text: "Done.", toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "skills", instructions: "Base prompt." }),
      threadRuntimeFactory: (snapshot) =>
        createSkillPluginThreadRuntime(
          {
            workspaceRoot: root,
            userHome: join(root, "home"),
            builtinSkillRoots: [],
            repoSkillRoots: [repoSkills],
            userSkillRoots: [],
            pluginRoots: [],
          },
          snapshot,
        ),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await runTurn(
      server,
      messages,
      threadId,
      3,
      "Use $review-code on this change.",
    );

    // First attempt to finish is rejected; the directive is fed back as input.
    expect(requests[0]?.input).toContain("$review-code");
    expect(requests[1]?.input).toContain(
      "Before finishing, you must load the explicitly requested skill(s) in full",
    );
    expect(requests[1]?.toolResults).toEqual([]);
    expect(requests[2]?.toolResults?.[0]?.name).toBe("skill_read");
    expect(requests[2]?.toolResults?.[0]?.output).toContain("REVIEW_WORKFLOW");
    const completed = messages.filter(
      (message) =>
        "method" in message &&
        message.method === "turn/completed" &&
        (message.params as { threadId?: string }).threadId === threadId,
    );
    expect(completed.length).toBe(1);
    expect(requests.length).toBe(3);
  });

  it("registers bundled resources for skills mentioned as $name in the input", async () => {
    const root = temporaryDirectory("threadlight-skill-mention-resources-");
    const repoSkills = join(root, ".agents", "skills");
    writeSkill(
      repoSkills,
      "release-check",
      "Check a release checklist.",
      "Read references/checklist.md before releasing.",
    );
    const checklistDir = join(repoSkills, "release-check", "references");
    mkdirSync(checklistDir, { recursive: true });
    const checklist = join(checklistDir, "checklist.md");
    writeFileSync(checklist, "RELEASE_CHECKLIST_CONTENT\n");
    const declaredChecklist = realpathSync(checklist);

    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "I'll load the skill.",
            toolCalls: [
              {
                id: "read-skill",
                name: "skill_read",
                arguments: { skill: "release-check" },
              },
            ],
          };
        }
        if (requests.length === 2) {
          return {
            text: "I'll read the bundled resource.",
            toolCalls: [
              {
                id: "read-resource",
                name: "capability_resource_read",
                arguments: { path: declaredChecklist },
              },
            ],
          };
        }
        return { text: "Release check complete.", toolCalls: [] };
      },
    };
    const messages: JsonRpcOutgoing[] = [];
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "skills", instructions: "Base prompt." }),
      threadRuntimeFactory: (snapshot) =>
        createSkillPluginThreadRuntime(
          {
            workspaceRoot: root,
            userHome: join(root, "home"),
            builtinSkillRoots: [],
            repoSkillRoots: [repoSkills],
            userSkillRoots: [],
            pluginRoots: [],
          },
          snapshot,
        ),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await runTurn(
      server,
      messages,
      threadId,
      3,
      "Use $release-check for this build.",
    );

    expect(requests[0]?.tools.map(({ name }) => name)).toContain(
      "capability_resource_read",
    );
    expect(requests[1]?.toolResults?.[0]?.name).toBe("skill_read");
    expect(requests[2]?.toolResults?.[0]?.name).toBe(
      "capability_resource_read",
    );
    expect(requests[2]?.toolResults?.[0]?.output).toContain(
      "RELEASE_CHECKLIST_CONTENT",
    );
    const completed = messages.filter(
      (message) =>
        "method" in message &&
        message.method === "turn/completed" &&
        (message.params as { threadId?: string }).threadId === threadId,
    );
    expect(completed.length).toBe(1);
  });

  it("ships skill-creator as a built-in discoverable skill", async () => {
    const registry = await SkillRegistry.discover({
      sources: [
        {
          scope: "builtin",
          root: defaultBuiltinSkillRoot(),
        },
      ],
    });
    expect(registry.descriptors()).toMatchObject([
      {
        name: "skill-creator",
        invocationName: "skill-creator",
        scope: "builtin",
      },
    ]);
    expect(registry.read("skill-creator").instructions).toContain(
      "Call `skill_create`",
    );
    expect(
      registry.descriptors().find((skill) => skill.name === "skill-creator")
        ?.description,
    ).toContain("dedicated reusable agent, teacher, coach, or expert");
  });

  it("creates a project skill through the built-in creator workflow", async () => {
    const root = temporaryDirectory("threadlight-builtin-skill-creator-");
    const messages: JsonRpcOutgoing[] = [];
    let generation = 0;
    const provider: ModelProvider = {
      async generate(request) {
        generation += 1;
        if (generation === 1) {
          expect(request.instructions).toContain("Required skill read");
          expect(request.instructions).toContain("$skill-creator");
          return {
            text: "I’ll load the creator skill.",
            toolCalls: [
              {
                id: "skill-read-creator",
                name: "skill_read",
                arguments: { skill: "skill-creator" },
              },
            ],
          };
        }
        if (generation === 2) {
          expect(request.toolResults?.[0]?.name).toBe("skill_read");
          return {
            text: "I’ll create the focused skill.",
            toolCalls: [
              {
                id: "skill-create-1",
                name: "skill_create",
                arguments: {
                  scope: "project",
                  name: "check-release",
                  description:
                    "Check release readiness when the user asks whether a build can ship.",
                  instructions:
                    "Run the offline release checks. Report blockers and the final readiness decision.",
                },
              },
            ],
          };
        }
        expect(request.toolResults?.[0]?.name).toBe("skill_create");
        return { text: "Created the skill.", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "creator", instructions: "Base prompt." }),
      threadRuntimeFactory: (snapshot) =>
        createSkillPluginThreadRuntime(
          {
            workspaceRoot: root,
            userHome: join(root, "home"),
            repoSkillRoots: [],
            userSkillRoots: [],
            pluginRoots: [],
          },
          snapshot,
        ),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await runTurn(
      server,
      messages,
      threadId,
      3,
      "Use $skill-creator to create a release checking skill.",
    );

    expect(
      readFileSync(
        join(root, ".agents", "skills", "check-release", "SKILL.md"),
        "utf8",
      ),
    ).toContain("name: check-release");
  });

  it("loads the built-in creator for an implicitly matched reusable teacher agent", async () => {
    const root = temporaryDirectory("threadlight-implicit-skill-creator-");
    const messages: JsonRpcOutgoing[] = [];
    const requests: ModelRequest[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.instructions).toContain(
            "dedicated reusable agent, teacher, coach, or expert",
          );
          expect(request.instructions).not.toContain(
            "Treat a dedicated agent, teacher, coach, or expert",
          );
          return {
            text: "I’ll load the reusable agent workflow.",
            toolCalls: [
              {
                id: "skill-read-creator",
                name: "skill_read",
                arguments: { skill: "skill-creator" },
              },
            ],
          };
        }
        if (requests.length === 2) {
          expect(request.toolResults?.[0]?.name).toBe("skill_read");
          expect(request.toolResults?.[0]?.output).toContain(
            "Treat a dedicated agent, teacher, coach, or expert",
          );
          return {
            text: "I’ll create the reusable teacher skill.",
            toolCalls: [
              {
                id: "skill-create-teacher",
                name: "skill_create",
                arguments: {
                  scope: "project",
                  name: "geo-teacher",
                  description:
                    "Teach GEO through a structured curriculum when the user asks to start or continue GEO learning.",
                  instructions:
                    "Track the learner's current unit. Teach one focused GEO lesson, assign a practical exercise, assess the answer, and record the next unit.",
                },
              },
            ],
          };
        }
        expect(request.toolResults?.[0]?.name).toBe("skill_create");
        return { text: "Created the reusable GEO teacher.", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "creator", instructions: "Base prompt." }),
      threadRuntimeFactory: (snapshot) =>
        createSkillPluginThreadRuntime(
          {
            workspaceRoot: root,
            userHome: join(root, "home"),
            repoSkillRoots: [],
            userSkillRoots: [],
            pluginRoots: [],
          },
          snapshot,
        ),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await runTurn(
      server,
      messages,
      threadId,
      3,
      "制作一个可复用的 GEO 老师 Agent，之后输入开始学习就继续课程。",
    );

    expect(requests).toHaveLength(3);
    expect(
      readFileSync(
        join(root, ".agents", "skills", "geo-teacher", "SKILL.md"),
        "utf8",
      ),
    ).toContain("name: geo-teacher");
  });

  it("deduplicates the same canonical project skill across .agents and .codex", async () => {
    const root = temporaryDirectory("threadlight-skill-dedup-path-");
    const agentSkills = join(root, ".agents", "skills");
    const codexSkills = join(root, ".codex", "skills");
    mkdirSync(join(root, ".agents"), { recursive: true });
    writeSkill(
      codexSkills,
      "emil-design-eng",
      "Apply Emil Kowalski's design engineering philosophy.",
      "DESIGN_ENGINEERING_WORKFLOW",
    );
    symlinkSync(codexSkills, agentSkills, "dir");

    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [],
      userSkillRoots: [],
      pluginRoots: [],
    });

    expect(runtime.snapshot.skills.skills).toHaveLength(1);
    expect(runtime.snapshot.skills.skills[0]).toMatchObject({
      name: "emil-design-eng",
      invocationName: "emil-design-eng",
      scope: "repo",
    });
    expect(runtime.snapshot.skills.warnings).toEqual([]);
  });

  it("loads project .codex skills and prefers .agents on name collisions", async () => {
    const root = temporaryDirectory("threadlight-project-codex-skills-");
    const agentSkills = join(root, ".agents", "skills");
    const codexSkills = join(root, ".codex", "skills");
    writeSkill(
      agentSkills,
      "shared-helper",
      "Run the primary project workflow.",
      "PRIMARY_PROJECT_WORKFLOW",
    );
    writeSkill(
      codexSkills,
      "shared-helper",
      "Run the compatibility project workflow.",
      "DUPLICATE_PROJECT_WORKFLOW",
    );
    writeSkill(
      codexSkills,
      "resume-interview",
      "Continue a structured resume interview.",
      "CODEX_PROJECT_INTERVIEW_WORKFLOW",
    );

    const runtimeOptions = {
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [] as const,
      userSkillRoots: [] as const,
      pluginRoots: [] as const,
    };
    const runtime = await createSkillPluginThreadRuntime(runtimeOptions);
    const skills = runtime.snapshot.skills.skills;
    expect(skills).toHaveLength(2);
    expect(
      skills.find((skill) => skill.name === "shared-helper")?.source,
    ).toContain("PRIMARY_PROJECT_WORKFLOW");
    expect(
      skills.find((skill) => skill.name === "resume-interview")?.path,
    ).toContain(".codex");
    expect(runtime.snapshot.skills.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("$shared-helper is already registered"),
      ]),
    );

    const requests: ModelRequest[] = [];
    const messages: JsonRpcOutgoing[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          expect(request.instructions).toContain("$resume-interview");
          return {
            text: "I’ll load the project skill.",
            toolCalls: [
              {
                id: "read-project-codex-skill",
                name: "skill_read",
                arguments: { skill: "resume-interview" },
              },
            ],
          };
        }
        expect(request.toolResults?.[0]?.name).toBe("skill_read");
        expect(request.toolResults?.[0]?.output).toContain(
          "CODEX_PROJECT_INTERVIEW_WORKFLOW",
        );
        return { text: "Project skill loaded.", toolCalls: [] };
      },
    };
    const server = new AppServer({
      loop: new AgentLoop(provider),
      agent: defineAgent({ name: "skills", instructions: "Base prompt." }),
      threadRuntimeFactory: (snapshot) =>
        createSkillPluginThreadRuntime(runtimeOptions, snapshot),
      send: (message) => messages.push(message),
    });

    await server.receive({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await server.receive({ jsonrpc: "2.0", id: 2, method: "thread/start" });
    const threadId = result<{ threadId: string }>(messages, 2).threadId;
    await runTurn(
      server,
      messages,
      threadId,
      3,
      "Use $resume-interview to continue.",
    );

    expect(requests).toHaveLength(2);
  });

  it("scans ~/.codex/skills as an extra user source and prefers ~/.agents/skills on name collisions", async () => {
    const root = temporaryDirectory("threadlight-codex-skills-");
    const userSkills = join(root, "home", ".agents", "skills");
    const codexSkills = join(root, "home", ".codex", "skills");
    writeSkill(
      userSkills,
      "personal-helper",
      "Run the primary personal workflow.",
      "PRIMARY_WORKFLOW",
    );
    writeSkill(
      codexSkills,
      "personal-helper",
      "Run the duplicated personal workflow.",
      "DUPLICATE_WORKFLOW",
    );
    writeSkill(
      codexSkills,
      "emil-design-eng",
      "Apply Emil Kowalski's design engineering philosophy.",
      "DESIGN_ENGINEERING_WORKFLOW",
    );

    const runtime = await createSkillPluginThreadRuntime({
      workspaceRoot: root,
      userHome: join(root, "home"),
      builtinSkillRoots: [],
      repoSkillRoots: [],
      pluginRoots: [],
    });

    const skills = runtime.snapshot.skills.skills;
    expect(skills).toHaveLength(2);
    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "personal-helper",
          invocationName: "personal-helper",
        }),
        expect.objectContaining({
          name: "emil-design-eng",
          invocationName: "emil-design-eng",
        }),
      ]),
    );
    expect(
      skills.find((skill) => skill.name === "personal-helper")?.source,
    ).toContain("PRIMARY_WORKFLOW");
    expect(
      skills.find((skill) => skill.name === "emil-design-eng")?.path,
    ).toContain(".codex");
    expect(runtime.snapshot.skills.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("$personal-helper is already registered"),
      ]),
    );
    expect(runtime.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "emil-design-eng",
          source: "user",
          visibility: "search",
        }),
      ]),
    );
  });
});

function scriptedSkillProvider(requests: ModelRequest[]): ModelProvider {
  return {
    async generate(request) {
      requests.push(request);
      if (request.input?.includes("$review-code")) {
        if (!request.toolResults?.length) {
          return {
            text: "I'll load the requested skill.",
            toolCalls: [
              {
                id: "skill-read-explicit",
                name: "skill_read",
                arguments: { skill: "review-code" },
              },
            ],
          };
        }
        return { text: "explicit complete", toolCalls: [] };
      }
      if (
        request.input?.includes("correctness review") &&
        !request.toolResults?.length
      ) {
        return {
          text: "I’ll load the matching workflow.",
          toolCalls: [
            {
              id: "skill-read-1",
              name: "skill_read",
              arguments: { skill: "review-code" },
            },
          ],
        };
      }
      return { text: "implicit complete", toolCalls: [] };
    },
  };
}

function writeSkill(
  root: string,
  name: string,
  description: string,
  instructions: string,
): void {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      "---",
      "",
      instructions,
      "",
    ].join("\n"),
  );
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

async function runTurn(
  server: AppServer,
  messages: JsonRpcOutgoing[],
  threadId: string,
  id: number,
  input: string,
): Promise<void> {
  const completed = waitForCompletion(messages, threadId);
  await server.receive({
    jsonrpc: "2.0",
    id,
    method: "turn/start",
    params: { threadId, input },
  });
  await completed;
}

function waitForCompletion(
  messages: JsonRpcOutgoing[],
  threadId: string,
): Promise<void> {
  return new Promise((resolve) => {
    const poll = () => {
      if (
        messages.some(
          (message) =>
            "method" in message &&
            message.method === "turn/completed" &&
            (message.params as { threadId?: string }).threadId === threadId,
        )
      ) {
        resolve();
      } else {
        setTimeout(poll, 0);
      }
    };
    poll();
  });
}

function result<Result>(
  messages: readonly JsonRpcOutgoing[],
  id: number,
): Result {
  const message = messages.find(
    (candidate) => "id" in candidate && candidate.id === id,
  );
  if (!message || !("result" in message))
    throw new Error(`Missing result ${id}`);
  return message.result as Result;
}
