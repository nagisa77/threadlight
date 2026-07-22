import { mkdtemp, realpath } from "node:fs/promises";
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

import { createExecCommandTool } from "../src/exec-command.js";
import { ProcessManager } from "../src/process-manager.js";
import {
  createProcessKillTool,
  createProcessReadTool,
  createProcessStatusTool,
  createProcessWaitTool,
} from "../src/process-tools.js";
import { createWebSearchTool } from "../src/web-search.js";

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
            arguments: { command: this.command, cwd: null, timeout_ms: 80 },
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
  it("executes an approved command and returns structured output to the model", async () => {
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
    let approvals = 0;
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
      {
        async approve() {
          approvals += 1;
          return true;
        },
      },
    );

    const output = JSON.parse(result.output) as {
      cwd: string;
      exitCode: number;
      stdout: string;
    };
    expect(approvals).toBe(1);
    expect(output).toMatchObject({
      cwd: await realpath(workspaceRoot),
      exitCode: 0,
      stdout: "hello",
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
    let approvals = 0;

    const result = await new AgentLoop(provider).run(
      defineAgent({
        name: "managed-process-test",
        instructions: "Use managed process tools",
        tools,
      }),
      "Run a managed command",
      {
        async approve() {
          approvals += 1;
          return true;
        },
      },
    );

    expect(approvals).toBe(2);
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
      apiKey: "test-search-key",
      fetch: fetchMock,
    });

    expect(tool.parameters).toMatchObject({
      properties: {
        query: { type: "string" },
        count: { type: ["integer", "null"] },
        country: { type: ["string", "null"] },
        search_lang: {
          type: ["string", "null"],
          enum: expect.arrayContaining(["en", "zh-hans", "zh-hant", null]),
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
    expect(requestHeaders?.get("X-Subscription-Token")).toBe(
      "test-search-key",
    );
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
      apiKey: "test-search-key",
      fetch: fetchMock,
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
      apiKey: "test-search-key",
      fetch: fetchMock,
    });

    await expect(
      tool.execute(
        {
          query: "unsupported language",
          count: null,
          country: null,
          search_lang: "not-a-language",
          freshness: null,
        },
        { runId: "run_search", signal: new AbortController().signal },
      ),
    ).rejects.toThrow("search_lang must be a language supported by Brave Search");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
