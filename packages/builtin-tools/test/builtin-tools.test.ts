import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
  type ModelRequest,
  type ModelTurn,
  type ToolCall,
} from "@threadlight/agent-loop";
import { describe, expect, it, vi } from "vitest";

import { createComputerUseTool } from "../src/computer-use.js";
import { createBraveSearchProvider } from "../src/brave-search-provider.js";
import { createExecCommandTool } from "../src/exec-command.js";
import { createLinkupSearchProvider } from "../src/linkup-search-provider.js";
import { createRequestPlanInputTool } from "../src/request-plan-input.js";
import { ProcessManager } from "../src/process-manager.js";
import {
  createProcessKillTool,
  createProcessReadTool,
  createProcessStatusTool,
  createProcessWaitTool,
} from "../src/process-tools.js";
import { createWebSearchTool } from "../src/web-search.js";
import {
  createAdvancePlanTool,
  createUpdatePlanTool,
  parsePlanSnapshot,
  PlanToolRuntime,
} from "../src/update-plan.js";

function richStep(
  step: string,
  status: "pending" | "in_progress" | "completed",
) {
  return {
    step,
    details: `Carry out ${step.trim()} with the relevant project constraints and edge cases.`,
    acceptanceCriteria: [`${step.trim()} is complete and verified.`],
    status,
  };
}

class ScriptedToolProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly call: ToolCall) {}

  async generate(request: ModelRequest): Promise<ModelTurn> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return { text: "", toolCalls: [this.call] };
    }

    return {
      text: request.toolResults?.[0]?.output ?? "missing tool result",
      toolCalls: [],
    };
  }
}

class ScriptedProcessProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly command: string) {}

  async generate(request: ModelRequest): Promise<ModelTurn> {
    this.requests.push(request);
    if (this.requests.length === 1) {
      return {
        text: "",
        toolCalls: [
          {
            id: "call_exec",
            name: "exec_command",
            arguments: { command: this.command, cwd: null, timeout_ms: 250 },
          },
        ],
      };
    }

    const process = JSON.parse(request.toolResults?.[0]?.output ?? "{}") as {
      sessionId?: string;
      status?: string;
      timedOut?: boolean;
    };
    if (!process.sessionId) throw new Error("missing managed process session");

    if (this.requests.length === 2) {
      expect(process).toMatchObject({ status: "running", timedOut: true });
      return {
        text: "",
        toolCalls: [
          {
            id: "call_status",
            name: "process_status",
            arguments: { session_id: process.sessionId },
          },
        ],
      };
    }
    if (this.requests.length === 3) {
      expect(process.status).toBe("running");
      return {
        text: "",
        toolCalls: [
          {
            id: "call_read",
            name: "process_read",
            arguments: { session_id: process.sessionId },
          },
        ],
      };
    }
    if (this.requests.length === 4) {
      expect(process.status).toBe("running");
      return {
        text: "",
        toolCalls: [
          {
            id: "call_wait",
            name: "process_wait",
            arguments: { session_id: process.sessionId, timeout_ms: 20 },
          },
        ],
      };
    }
    if (this.requests.length === 5) {
      expect(process.status).toBe("running");
      return {
        text: "",
        toolCalls: [
          {
            id: "call_kill",
            name: "process_kill",
            arguments: { session_id: process.sessionId },
          },
        ],
      };
    }

    return {
      text: JSON.stringify(process),
      toolCalls: [],
    };
  }
}

describe("builtin tools", () => {
  it("validates the turn-scoped blocking input tool", async () => {
    const tool = createRequestPlanInputTool();
    const context = {
      runId: "run-1",
      signal: new AbortController().signal,
    };

    await expect(
      tool.execute(
        {
          missing_information: "The deployment environment",
          question: " Which environment should I target? ",
        },
        context,
      ),
    ).resolves.toBe("Which environment should I target?");
    await expect(
      tool.execute(
        {
          missing_information: "",
          question: "Which environment?",
        },
        context,
      ),
    ).rejects.toThrow("missing_information");
  });

  it("writes each plan update to a readable workspace document", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "threadlight-plan-"));
    try {
      const result = await createUpdatePlanTool({
        workspaceRoot,
      }).execute(
        {
          explanation: "Keep the implementation visible.",
          plan: [
            richStep("Inspect architecture", "completed"),
            richStep("Open the plan document", "in_progress"),
            richStep("Verify behavior", "pending"),
          ],
        },
        {
          runId: "run-1",
          scopeId: "thread-1",
          signal: new AbortController().signal,
        },
      );
      expect(result).toMatchObject({
        documentPath: ".threadlight/plans/run-1.md",
        documentVersion: expect.stringMatching(/^[a-f0-9]{16}$/),
      });
      const firstDocument = await readFile(
        join(workspaceRoot, ".threadlight", "plans", "run-1.md"),
        "utf8",
      );
      expect(firstDocument).toContain("### 2. Open the plan document");
      expect(firstDocument).toContain(
        "Carry out Open the plan document with the relevant project constraints and edge cases.",
      );
      expect(firstDocument).toContain(
        "- [ ] Open the plan document is complete and verified.",
      );

      const nextTurn = await createUpdatePlanTool({
        workspaceRoot,
      }).execute(
        {
          plan: [richStep("Handle the next request", "in_progress")],
        },
        {
          runId: "run-2",
          scopeId: "thread-1",
          signal: new AbortController().signal,
        },
      );
      expect(nextTurn).toMatchObject({
        documentPath: ".threadlight/plans/run-2.md",
      });
      await expect(
        readFile(
          join(workspaceRoot, ".threadlight", "plans", "run-1.md"),
          "utf8",
        ),
      ).resolves.toContain("### 2. Open the plan document");
      await expect(
        readFile(
          join(workspaceRoot, ".threadlight", "plans", "run-2.md"),
          "utf8",
        ),
      ).resolves.toContain("### 1. Handle the next request");
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("advances the active plan step without retransmitting the plan", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "threadlight-plan-"));
    const runtime = new PlanToolRuntime();
    const context = {
      runId: "run-advance",
      scopeId: "thread-1",
      signal: new AbortController().signal,
    };
    try {
      await createUpdatePlanTool({
        workspaceRoot,
        runtime,
      }).execute(
        {
          explanation: "Keep transitions atomic.",
          plan: [
            richStep("Inspect architecture", "in_progress"),
            richStep("Implement change", "pending"),
          ],
        },
        context,
      );

      const result = await createAdvancePlanTool({
        workspaceRoot,
        runtime,
      }).execute(
        {
          completionEvidence: [
            "The relevant controller and tool paths were inspected.",
          ],
        },
        context,
      );

      expect(result).toMatchObject({
        explanation: "Keep transitions atomic.",
        plan: [
          {
            step: "Inspect architecture",
            status: "completed",
            completionEvidence: [
              "The relevant controller and tool paths were inspected.",
            ],
          },
          { step: "Implement change", status: "in_progress" },
        ],
        documentPath: ".threadlight/plans/run-advance.md",
      });
      await expect(
        readFile(
          join(workspaceRoot, ".threadlight", "plans", "run-advance.md"),
          "utf8",
        ),
      ).resolves.toContain(
        "- The relevant controller and tool paths were inspected.",
      );
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("tracks a scripted provider plan through the provider-neutral tool loop", async () => {
    const requests: ModelRequest[] = [];
    const updates: unknown[] = [];
    const provider: ModelProvider = {
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "I’ll plan the work.",
            toolCalls: [
              {
                id: "plan-1",
                name: "update_plan",
                arguments: {
                  plan: [
                    richStep("Inspect the code", "in_progress"),
                    richStep("Implement the change", "pending"),
                  ],
                },
              },
            ],
          };
        }
        if (requests.length === 2) {
          expect(
            JSON.parse(request.toolResults?.[0]?.output ?? "{}"),
          ).toMatchObject({
            plan: [
              richStep("Inspect the code", "in_progress"),
              richStep("Implement the change", "pending"),
            ],
          });
          return {
            text: "Inspection is complete.",
            toolCalls: [
              {
                id: "plan-2",
                name: "update_plan",
                arguments: {
                  plan: [
                    richStep("Inspect the code", "completed"),
                    richStep("Implement the change", "in_progress"),
                  ],
                },
              },
            ],
          };
        }
        return { text: "Done", toolCalls: [] };
      },
    };
    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "planner",
        instructions: "Plan multi-step work",
        tools: [
          createUpdatePlanTool({
            onUpdate: (snapshot) => updates.push(snapshot),
          }),
        ],
      }),
      "Make the change",
    );

    expect(result.output).toBe("Done");
    expect(requests[0]?.tools.map((tool) => tool.name)).toContain(
      "update_plan",
    );
    expect(updates).toHaveLength(2);
    expect(updates.at(-1)).toMatchObject({
      plan: [{ status: "completed" }, { status: "in_progress" }],
    });
  });

  it("rejects ambiguous or duplicate plan updates offline", () => {
    expect(() =>
      parsePlanSnapshot({
        plan: [{ step: "Build", status: "in_progress" }],
      }),
    ).toThrow("details");
    expect(() =>
      parsePlanSnapshot({
        plan: [
          richStep("Build", "in_progress"),
          richStep("Test", "in_progress"),
        ],
      }),
    ).toThrow("at most one");
    expect(() =>
      parsePlanSnapshot({
        plan: [richStep("Build", "pending"), richStep(" Build ", "completed")],
      }),
    ).toThrow("unique");
  });

  it("executes a computer action batch and returns a PNG screenshot", async () => {
    const execute = vi.fn(async () =>
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    );
    const tool = createComputerUseTool({ driver: { execute } });
    const actions = [
      { type: "screenshot" as const },
      {
        type: "click" as const,
        x: 320,
        y: 180,
        button: "left" as const,
        keys: [],
      },
    ];
    const pendingSafetyChecks = [
      {
        id: "safety-1",
        code: "confirm_action",
        message: "Confirm the click",
      },
    ];
    const provider = new ScriptedToolProvider({
      id: "call_computer",
      name: "computer",
      arguments: { actions, pendingSafetyChecks },
    });

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "computer-test",
        instructions: "Use computer",
        tools: [tool],
      }),
      "Inspect the screen",
    );

    expect(tool.kind).toBe("computer");
    expect(provider.requests[0]?.tools).toMatchObject([
      { name: "computer", kind: "computer" },
    ]);
    expect(execute).toHaveBeenCalledWith(
      actions,
      expect.objectContaining({
        runId: expect.any(String),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(JSON.parse(result.output)).toEqual({
      type: "computer_screenshot",
      imageUrl: "data:image/png;base64,iVBORw==",
      detail: "original",
      acknowledgedSafetyChecks: pendingSafetyChecks,
    });
  });

  it("executes a command directly and returns structured output to the model", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "threadlight-exec-"));
    const provider = new ScriptedToolProvider({
      id: "call_exec",
      name: "exec_command",
      arguments: {
        command: `${JSON.stringify(process.execPath)} -e "process.stdout.write('hello')"`,
        cwd: null,
        timeout_ms: null,
      },
    });
    const tool = createExecCommandTool({ workspaceRoot });

    expect(tool.parameters).toMatchObject({
      properties: {
        command: { type: "string" },
        cwd: { type: ["string", "null"] },
        timeout_ms: { type: ["integer", "null"] },
      },
      required: ["command", "cwd", "timeout_ms"],
      additionalProperties: false,
    });

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "test",
        instructions: "Use the requested tool",
        tools: [tool],
      }),
      "Run a command",
    );

    const output = JSON.parse(result.output) as {
      cwd: string;
      exitCode: number;
      stdout: string;
    };
    expect(output).toMatchObject({
      cwd: await realpath(workspaceRoot),
      exitCode: 0,
      stdout: "hello",
    });
  });

  it("reports zero-exit commands with stderr as completed with warnings", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "threadlight-warning-"));
    const provider = new ScriptedToolProvider({
      id: "call_exec_warning",
      name: "exec_command",
      arguments: {
        command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
          "process.stderr.write('optional tool unavailable\\n')",
        )}`,
        cwd: null,
        timeout_ms: null,
      },
    });

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "warning-test",
        instructions: "Run the diagnostic",
        tools: [createExecCommandTool({ workspaceRoot })],
      }),
      "Run a diagnostic",
    );

    expect(JSON.parse(result.output)).toMatchObject({
      status: "completed_with_warnings",
      exitCode: 0,
      stderr: "optional tool unavailable\n",
    });
  });

  it("rejects a command working directory outside the configured workspace", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "threadlight-cwd-"));
    const tool = createExecCommandTool({ workspaceRoot });

    await expect(
      tool.execute(
        { command: "pwd", cwd: ".." },
        { runId: "run_1", signal: new AbortController().signal },
      ),
    ).rejects.toThrow("cwd must stay within the configured workspace root");
  });

  it("returns an opaque session and manages it through process tools", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "threadlight-process-"));
    const processManager = new ProcessManager({
      createSessionId: () => "session_opaque_1",
    });
    const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(
      "process.stdout.write('started\\n'); setInterval(() => {}, 1000)",
    )}`;
    const provider = new ScriptedProcessProvider(command);
    const tools = [
      createExecCommandTool({
        workspaceRoot,
        defaultTimeoutMs: 20,
        maxTimeoutMs: 1_000,
        processManager,
      }),
      createProcessStatusTool({ processManager }),
      createProcessReadTool({ processManager }),
      createProcessWaitTool({ processManager }),
      createProcessKillTool({ processManager }),
    ];
    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "managed-process-test",
        instructions: "Use managed process tools",
        tools,
      }),
      "Run a managed command",
    );

    expect(JSON.parse(result.output)).toMatchObject({
      sessionId: "session_opaque_1",
      status: "terminated",
      stdout: "started\n",
    });
    await expect(
      tools[3]?.execute(
        { session_id: "session_opaque_1", timeout_ms: 50 },
        { runId: "wait_after_kill", signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({ status: "terminated" });
  });

  it("searches through an injected fetch and returns results to the model", async () => {
    let requestUrl: URL | undefined;
    let requestHeaders: Headers | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      requestUrl = new URL(input.toString());
      requestHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: "Threadlight",
                url: "https://example.com/threadlight",
                description: "A small agent runtime.",
                language: "en",
              },
            ],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const provider = new ScriptedToolProvider({
      id: "call_search",
      name: "web_search",
      arguments: {
        query: "threadlight runtime",
        count: 3,
        country: "us",
        search_lang: "zh",
        freshness: null,
      },
    });
    const tool = createWebSearchTool({
      provider: createBraveSearchProvider({
        apiKey: "test-search-key",
        fetch: fetchMock,
      }),
    });

    expect(tool.description).toContain(
      "Prioritize first-party official sources",
    );
    expect(tool.description).toContain(
      "search English and global sources by default",
    );
    expect(tool.parameters).toMatchObject({
      properties: {
        query: { type: "string" },
        count: { type: ["integer", "null"] },
        country: { type: ["string", "null"] },
        search_lang: {
          type: ["string", "null"],
        },
        freshness: {
          type: ["string", "null"],
          enum: ["pd", "pw", "pm", "py", null],
        },
      },
      required: ["query", "count", "country", "search_lang", "freshness"],
      additionalProperties: false,
    });

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "test",
        instructions: "Use the requested tool",
        tools: [tool],
      }),
      "Search for Threadlight",
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestUrl?.origin + requestUrl?.pathname).toBe(
      "https://api.search.brave.com/res/v1/web/search",
    );
    expect(requestUrl?.searchParams.get("q")).toBe("threadlight runtime");
    expect(requestUrl?.searchParams.get("count")).toBe("3");
    expect(requestUrl?.searchParams.get("country")).toBe("US");
    expect(requestUrl?.searchParams.get("search_lang")).toBe("zh-hans");
    expect(requestHeaders?.get("X-Subscription-Token")).toBe("test-search-key");
    expect(JSON.parse(result.output)).toEqual({
      query: "threadlight runtime",
      results: [
        {
          title: "Threadlight",
          url: "https://example.com/threadlight",
          description: "A small agent runtime.",
          language: "en",
        },
      ],
    });
  });

  it.each([
    ["zh_CN", "zh-hans"],
    ["zh-TW", "zh-hant"],
    ["JA", "jp"],
  ])("normalizes search language %s to %s", async (input, expected) => {
    let requestUrl: URL | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (request) => {
      requestUrl = new URL(request.toString());
      return new Response(JSON.stringify({ web: { results: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const tool = createWebSearchTool({
      provider: createBraveSearchProvider({
        apiKey: "test-search-key",
        fetch: fetchMock,
      }),
    });

    await tool.execute(
      {
        query: "language normalization",
        count: null,
        country: null,
        search_lang: input,
        freshness: null,
      },
      { runId: "run_search", signal: new AbortController().signal },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(requestUrl?.searchParams.get("search_lang")).toBe(expected);
  });

  it("rejects unsupported search languages before calling Brave", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const tool = createWebSearchTool({
      provider: createBraveSearchProvider({
        apiKey: "test-search-key",
        fetch: fetchMock,
      }),
    });

    await expect(
      tool.execute(
        {
          query: "unsupported language",
          count: null,
          country: null,
          search_lang: "eo",
          freshness: null,
        },
        { runId: "run_search", signal: new AbortController().signal },
      ),
    ).rejects.toThrow(
      "search_lang must be a language supported by Brave Search",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("searches Linkup through the provider-neutral tool contract", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      requestUrl = input.toString();
      requestInit = init;
      return new Response(
        JSON.stringify({
          results: [
            {
              type: "text",
              name: "Threadlight architecture",
              url: "https://example.com/architecture",
              content: "A provider-neutral agent runtime.",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
    const modelProvider = new ScriptedToolProvider({
      id: "call_linkup_search",
      name: "web_search",
      arguments: {
        query: "Threadlight architecture",
        count: 4,
        country: "cn",
        search_lang: "zh-CN",
        freshness: "pw",
      },
    });
    const tool = createWebSearchTool({
      provider: createLinkupSearchProvider({
        apiKey: "test-linkup-key",
        fetch: fetchMock,
        now: () => new Date("2026-08-11T12:00:00.000Z"),
      }),
    });

    const result = await new AgentLoop(modelProvider).run(
      defineAgent({
        name: "linkup-test",
        instructions: "Use the requested tool",
        tools: [tool],
      }),
      "Search with Linkup",
    );

    expect(requestUrl).toBe("https://api.linkup.so/v1/search");
    expect(requestInit?.method).toBe("POST");
    expect(new Headers(requestInit?.headers).get("Authorization")).toBe(
      "Bearer test-linkup-key",
    );
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      q: "Threadlight architecture\n\nSearch preferences: Prioritize sources relevant to country code CN. Prefer sources written in zh-CN when possible.",
      depth: "standard",
      outputType: "searchResults",
      maxResults: 4,
      fromDate: "2026-08-04",
    });
    expect(JSON.parse(result.output)).toEqual({
      query: "Threadlight architecture",
      results: [
        {
          title: "Threadlight architecture",
          url: "https://example.com/architecture",
          description: "A provider-neutral agent runtime.",
        },
      ],
    });
  });
});
