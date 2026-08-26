import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function lines(path: string): number {
  return source(path).split("\n").length;
}

function sourceFiles(path: string): string[] {
  const directory = new URL(path, import.meta.url);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = `${path.replace(/\/$/, "")}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(child);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [child] : [];
  });
}

function workspaceDependencies(packageName: string): string[] {
  const dependencies = new Set<string>();
  for (const file of sourceFiles(`../packages/${packageName}/src`)) {
    for (const match of source(file).matchAll(/@threadlight\/([a-z-]+)/g)) {
      dependencies.add(match[1]!);
    }
  }
  return [...dependencies].sort();
}

describe("runtime architecture boundaries", () => {
  it("keeps collaboration contracts and transcript bookkeeping out of orchestration", () => {
    const orchestrator = source(
      "../packages/agent-loop/src/agent-orchestrator.ts",
    );

    expect(
      lines("../packages/agent-loop/src/agent-orchestrator.ts"),
    ).toBeLessThan(2_350);
    expect(orchestrator).toContain("./collaboration-contract.js");
    expect(orchestrator).toContain("./orchestration-transcript.js");
    expect(orchestrator).not.toMatch(/const COLLABORATION_TOOLS\s*=/);
    expect(orchestrator).not.toMatch(/function serializeTranscript\(/);
  });

  it("keeps generated-content parsing out of the app-server transport class", () => {
    const appServer = source("../packages/app-server/src/app-server.ts");

    expect(lines("../packages/app-server/src/app-server.ts")).toBeLessThan(
      2_900,
    );
    expect(appServer).toContain("./generated-content.js");
    expect(appServer).not.toMatch(/function parseGeneratedTitle\(/);
    expect(appServer).not.toMatch(/function parseSuggestedQuestions\(/);
  });

  it("composes turn capabilities through the runtime module profile", () => {
    const appServer = source("../packages/app-server/src/app-server.ts");
    const modules = source(
      "../packages/app-server/src/turn-runtime-modules.ts",
    );

    expect(appServer).toContain("composeTurnRuntime(this.turnRuntimeModules");
    expect(appServer).not.toMatch(
      /new (PlanExecutionController|TurnCapabilityController|SkillReadRequirementController|SourceCitationRunController|ProjectMemoryReminderController|ResearchCoverageRunController)\b/,
    );
    expect(modules).toContain("export interface TurnRuntimeModule");
    expect(modules).toContain("defaultTurnRuntimeModules");
  });

  it("enforces the workspace dependency direction", () => {
    expect(workspaceDependencies("protocol")).toEqual([]);
    expect(workspaceDependencies("project-memory")).toEqual([]);
    expect(workspaceDependencies("agent-loop")).toEqual([]);
    expect(workspaceDependencies("model-providers")).toEqual(["agent-loop"]);
    expect(workspaceDependencies("builtin-tools")).toEqual([
      "agent-loop",
      "project-memory",
    ]);
    expect(workspaceDependencies("host-core")).toEqual([
      "project-memory",
      "protocol",
    ]);
    expect(workspaceDependencies("client")).toEqual(["protocol"]);
    expect(workspaceDependencies("ui")).toEqual(["client", "protocol"]);
  });

  it("keeps provider and transport wire formats outside the agent loop", () => {
    const loopSource = sourceFiles("../packages/agent-loop/src")
      .map(source)
      .join("\n");
    expect(loopSource).not.toMatch(
      /\b(OpenAI|Anthropic|JsonRpc|WebSocket|Responses API)\b/i,
    );
    expect(loopSource).not.toContain("@threadlight/model-providers");
    expect(source("../packages/app-server/src/app-server.ts")).not.toContain(
      "@threadlight/model-providers",
    );
  });

  it("routes JSON-RPC methods through a protocol component", () => {
    const appServer = source("../packages/app-server/src/app-server.ts");
    const router = source("../packages/app-server/src/rpc-router.ts");

    expect(lines("../packages/app-server/src/app-server.ts")).toBeLessThan(
      2_850,
    );
    expect(appServer).toContain('from "./rpc-router.js"');
    expect(appServer).not.toMatch(/switch \(method\)/);
    expect(router).toContain("export class RpcMethodRouter");
    expect(router).toContain("Method not found");
  });
});
