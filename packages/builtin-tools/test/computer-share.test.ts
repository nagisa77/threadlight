import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
  type ModelRequest,
  type ModelTurn,
} from "@threadlight/agent-loop";
import { describe, expect, it, vi } from "vitest";

import {
  createComputerShareTool,
  type ComputerShareRuntime,
} from "../src/index.js";

class ScriptedShareProvider implements ModelProvider {
  private turn = 0;

  async generate(request: ModelRequest): Promise<ModelTurn> {
    this.turn += 1;
    if (this.turn === 1) {
      return {
        text: "",
        toolCalls: [
          {
            id: "share-list",
            name: "computer_share",
            arguments: {
              action: "list",
              mode: null,
              target_ids: null,
              picture_in_picture: null,
              input_mode: null,
            },
          },
        ],
      };
    }
    if (this.turn === 2) {
      expect(JSON.parse(request.toolResults?.[0]?.output ?? "{}")).toMatchObject({
        targets: [{ id: "application:42", type: "application" }],
        guidance: expect.stringContaining("newly visible windows"),
      });
      return {
        text: "",
        toolCalls: [
          {
            id: "share-set",
            name: "computer_share",
            arguments: {
              action: "set",
              mode: "applications",
              target_ids: ["application:42"],
              picture_in_picture: true,
              input_mode: "virtual",
            },
          },
        ],
      };
    }
    return {
      text: request.toolResults?.[0]?.output ?? "",
      toolCalls: [],
    };
  }
}

describe("computer_share", () => {
  it("lets a scripted model list and select shared applications", async () => {
    const runtime: ComputerShareRuntime = {
      list: vi.fn(async () => [
        {
          id: "application:42",
          type: "application",
          name: "Safari",
          processId: 42,
        },
      ]),
      configure: vi.fn(async (options) => ({
        mode: options.mode,
        targets: [
          {
            id: "application:42",
            type: "application",
            name: "Safari",
            processId: 42,
          },
        ],
        pictureInPicture: options.pictureInPicture,
        canvas: { width: 1440, height: 900 },
        inputMode: options.inputMode,
      })),
      clear: vi.fn(async () => ({
        mode: "none",
        targets: [],
        pictureInPicture: false,
        canvas: { width: 1440, height: 900 },
        inputMode: "virtual",
      })),
    };
    const result = await new AgentLoop(new ScriptedShareProvider()).run(
      defineAgent({
        name: "share-test",
        instructions: "Choose the target",
        tools: [createComputerShareTool({ runtime })],
      }),
      "Open Safari",
    );

    expect(runtime.list).toHaveBeenCalledOnce();
    expect(runtime.configure).toHaveBeenCalledWith(
      {
        mode: "applications",
        targetIds: ["application:42"],
        pictureInPicture: true,
        inputMode: "virtual",
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(JSON.parse(result.output)).toMatchObject({
      mode: "applications",
      pictureInPicture: true,
      inputMode: "virtual",
    });
  });

  it("rejects set without targets", async () => {
    const runtime = {
      list: vi.fn(),
      configure: vi.fn(),
      clear: vi.fn(),
    } as unknown as ComputerShareRuntime;
    const tool = createComputerShareTool({ runtime });

    await expect(
      tool.execute(
        {
          action: "set",
          mode: "windows",
          target_ids: [],
          picture_in_picture: true,
          input_mode: "virtual",
        },
        { runId: "run", signal: new AbortController().signal },
      ),
    ).rejects.toThrow("target_ids must contain between 1 and 12");
  });
});
