import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function lines(path: string): number {
  return source(path).split("\n").length;
}

describe("runtime architecture boundaries", () => {
  it("keeps collaboration contracts and transcript bookkeeping out of orchestration", () => {
    const orchestrator = source(
      "../packages/agent-loop/src/agent-orchestrator.ts",
    );

    expect(lines("../packages/agent-loop/src/agent-orchestrator.ts")).toBeLessThan(
      2_350,
    );
    expect(orchestrator).toContain("./collaboration-contract.js");
    expect(orchestrator).toContain("./orchestration-transcript.js");
    expect(orchestrator).not.toMatch(/const COLLABORATION_TOOLS\s*=/);
    expect(orchestrator).not.toMatch(/function serializeTranscript\(/);
  });

  it("keeps generated-content parsing out of the app-server transport class", () => {
    const appServer = source("../packages/app-server/src/app-server.ts");

    expect(lines("../packages/app-server/src/app-server.ts")).toBeLessThan(2_900);
    expect(appServer).toContain("./generated-content.js");
    expect(appServer).not.toMatch(/function parseGeneratedTitle\(/);
    expect(appServer).not.toMatch(/function parseSuggestedQuestions\(/);
  });
});
