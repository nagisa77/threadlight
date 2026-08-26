import {
  defineTool,
  type RunController,
  type RunControllerContext,
} from "@threadlight/agent-loop";
import { describe, expect, it, vi } from "vitest";

import { composePrompt } from "../src/prompt-composer.js";
import {
  composeTurnRuntime,
  defaultTurnRuntimeModules,
  TurnRuntimeServiceKey,
  type TurnRuntimeModule,
} from "../src/turn-runtime-modules.js";

const CONTROLLER_CONTEXT: RunControllerContext = {
  runId: "run-1",
  step: 1,
  tools: [],
};

describe("turn runtime modules", () => {
  it("composes tools, prompts, controllers, hooks, and typed services", async () => {
    const serviceKey = new TurnRuntimeServiceKey<{ marker: string }>(
      "test.service",
    );
    const calls: string[] = [];
    const laterController: RunController = {
      beforeModel() {
        calls.push("later");
        return { instructions: "later" };
      },
    };
    const earlierController: RunController = {
      beforeModel() {
        calls.push("earlier");
        return { instructions: "earlier" };
      },
    };
    const modules: TurnRuntimeModule[] = [
      {
        id: "test.first",
        setup(_context, registrar) {
          registrar.addTools([
            defineTool({
              name: "module_tool",
              description: "A contributed tool",
              parameters: { type: "object", properties: {} },
              async execute() {
                return "ok";
              },
            }),
          ]);
          registrar.addPromptBlocks(
            [promptBlock("prompt.later", "later prompt")],
            200,
          );
          registrar.addController(laterController, 200);
          registrar.addInputHandler((input) => `${input}:first`);
          registrar.addOutputFinalizer(
            (output) => ({ ...output, text: `${output.text}:last` }),
            200,
          );
          registrar.provide(serviceKey, { marker: "available" });
        },
      },
      {
        id: "test.second",
        setup(_context, registrar) {
          expect(registrar.service(serviceKey)).toEqual({
            marker: "available",
          });
          registrar.addPromptBlocks(
            [promptBlock("prompt.earlier", "earlier prompt")],
            100,
          );
          registrar.addController(earlierController, 100);
          registrar.addInputHandler((input) => `${input}:second`);
          registrar.addOutputFinalizer(
            (output) => ({ ...output, text: `${output.text}:first` }),
            100,
          );
          registrar.wrapController((delegate) => ({
            async beforeModel(context) {
              const directive = await delegate?.beforeModel?.(context);
              return {
                ...directive,
                instructions: `${directive?.instructions}:wrapped`,
              };
            },
          }));
        },
      },
    ];

    const composition = await composeTurnRuntime(modules, context());

    expect(composition.tools.map(({ name }) => name)).toEqual([
      "base_tool",
      "module_tool",
    ]);
    expect(composition.promptBlocks.map(({ id }) => id)).toEqual([
      "host.base",
      "prompt.earlier",
      "prompt.later",
    ]);
    expect(composition.input).toBe("input:first:second");
    expect(await composition.processInput("next", [])).toBe(
      "next:first:second",
    );
    expect(composition.service(serviceKey)).toEqual({ marker: "available" });
    expect(
      await composition.controller?.beforeModel?.(CONTROLLER_CONTEXT),
    ).toEqual({ instructions: "earlier\n\nlater:wrapped" });
    expect(calls).toEqual(["earlier", "later"]);
    expect(await composition.finalizeOutput("output")).toEqual({
      text: "output:first:last",
      sources: [],
      citations: [],
    });
  });

  it("creates fresh child controllers from module factories", async () => {
    const factory = vi.fn((): RunController => ({
      beforeModel: () => ({
        instructions: `child-${factory.mock.calls.length}`,
      }),
    }));
    const composition = await composeTurnRuntime(
      [
        {
          id: "test.children",
          setup(_context, registrar) {
            registrar.addChildController(factory);
          },
        },
      ],
      context(),
    );

    const first = composition.createChildController();
    const second = composition.createChildController();
    expect(first).not.toBe(second);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("preserves the first-party tool and prompt contribution order", async () => {
    const composition = await composeTurnRuntime(defaultTurnRuntimeModules(), {
      ...context(),
      mode: "plan",
      attachments: [
        {
          id: "attachment-1",
          name: "brief.txt",
          mimeType: "text/plain",
          size: 5,
          kind: "file",
          path: "/tmp/brief.txt",
        },
      ],
      threadRuntime: {
        tools: [],
        capabilities: [],
        promptBlocksForTurn: () => [
          {
            id: "runtime.turn",
            version: 1,
            authority: "runtime",
            source: "test",
            content: "runtime prompt",
          },
        ],
        resolveCapabilities: async () => ({
          promptBlocks: [
            {
              id: "skill.selected",
              version: 1,
              authority: "skill",
              source: "test",
              content: "selected capability prompt",
            },
          ],
          tools: [
            defineTool({
              name: "capability_tool",
              description: "A selected capability tool",
              parameters: { type: "object", properties: {} },
              async execute() {
                return "ok";
              },
            }),
          ],
        }),
      },
    });

    expect(composition.tools.map(({ name }) => name)).toEqual([
      "base_tool",
      "request_plan_input",
      "attach_to_model_context",
      "capability_tool",
    ]);
    expect(composition.promptBlocks.map(({ id }) => id)).toEqual([
      "host.base",
      "runtime.turn",
      "skill.selected",
      "turn.plan-mode",
    ]);
  });

  it("rejects duplicate module ids and duplicate service providers", async () => {
    const duplicate: TurnRuntimeModule = { id: "duplicate", setup() {} };
    await expect(
      composeTurnRuntime([duplicate, duplicate], context()),
    ).rejects.toThrow("Duplicate turn runtime module: duplicate");

    const key = new TurnRuntimeServiceKey<string>("duplicate.service");
    await expect(
      composeTurnRuntime(
        [
          {
            id: "duplicate.services",
            setup(_context, registrar) {
              registrar.provide(key, "first");
              registrar.provide(key, "second");
            },
          },
        ],
        context(),
      ),
    ).rejects.toThrow("Duplicate turn runtime service: duplicate.service");
  });

  it("disposes mounted modules in reverse order, including setup failures", async () => {
    const calls: string[] = [];
    const composition = await composeTurnRuntime(
      [
        {
          id: "lifecycle.first",
          setup() {
            return () => {
              calls.push("first");
            };
          },
        },
        {
          id: "lifecycle.second",
          setup() {
            return () => {
              calls.push("second");
            };
          },
        },
      ],
      context(),
    );

    await composition.dispose();
    await composition.dispose();
    expect(calls).toEqual(["second", "first"]);

    calls.length = 0;
    await expect(
      composeTurnRuntime(
        [
          {
            id: "failure.mounted",
            setup() {
              return () => {
                calls.push("mounted");
              };
            },
          },
          {
            id: "failure.throwing",
            setup() {
              throw new Error("setup failed");
            },
          },
        ],
        context(),
      ),
    ).rejects.toThrow("setup failed");
    expect(calls).toEqual(["mounted"]);
  });
});

function context() {
  return {
    threadId: "thread-1",
    mode: "default" as const,
    accessMode: "approval" as const,
    taskInput: "input",
    input: "input",
    attachments: [],
    capabilityRefs: [],
    signal: new AbortController().signal,
    agentTools: [
      defineTool({
        name: "base_tool",
        description: "A base tool",
        parameters: { type: "object", properties: {} },
        async execute() {
          return "ok";
        },
      }),
    ],
    promptSnapshot: composePrompt([promptBlock("host.base", "base prompt")]),
    approval: {
      enabled: false,
      requester: vi.fn(),
    },
  };
}

function promptBlock(id: string, content: string) {
  return {
    id,
    version: 1,
    authority: "host" as const,
    source: "test",
    content,
  };
}
