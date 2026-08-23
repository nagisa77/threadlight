import { describe, expect, it } from "vitest";

import {
  parseThreadlightCli,
  ThreadlightCliUsageError,
} from "../src/command-cli-options.js";

describe("threadlight command options", () => {
  it("parses a project worktree run with model and capability overrides", () => {
    expect(
      parseThreadlightCli([
        "run",
        "--host",
        "https://host.example",
        "--project",
        "/srv/repository",
        "--worktree",
        "--plan",
        "--yes",
        "--provider",
        "openai",
        "--model",
        "gpt-test",
        "--capability",
        "skill:review",
        "Fix",
        "the",
        "tests",
      ]),
    ).toEqual({
      action: "run",
      endpoint: "https://host.example",
      json: false,
      standalone: false,
      developmentMode: "worktree",
      turnMode: "plan",
      fullAccess: false,
      approveWrites: true,
      project: "/srv/repository",
      provider: "openai",
      model: "gpt-test",
      capabilityRefs: ["skill:review"],
      prompt: "Fix the tests",
    });
  });

  it("parses standalone and existing-task targets", () => {
    expect(
      parseThreadlightCli(["run", "--standalone", "Research this"]),
    ).toMatchObject({
      action: "run",
      standalone: true,
      prompt: "Research this",
    });
    expect(
      parseThreadlightCli(["run", "--thread", "thread-1", "Continue"]),
    ).toMatchObject({
      action: "run",
      threadId: "thread-1",
      prompt: "Continue",
    });
    expect(
      parseThreadlightCli(["run", "--standalone", "--", "--help", "me"]),
    ).toMatchObject({ prompt: "--help me" });
  });

  it("requires an explicit target for a new task", () => {
    expect(() => parseThreadlightCli(["run", "Do something"])).toThrow(
      ThreadlightCliUsageError,
    );
  });

  it("rejects conflicting targets and worktree mode on an existing task", () => {
    expect(() =>
      parseThreadlightCli([
        "run",
        "--project",
        "one",
        "--standalone",
        "prompt",
      ]),
    ).toThrow("Use either --project or --standalone");
    expect(() =>
      parseThreadlightCli([
        "run",
        "--thread",
        "thread-1",
        "--worktree",
        "prompt",
      ]),
    ).toThrow("--worktree only applies");
  });
});
