import { describe, expect, it } from "vitest";

import {
  AgentLoop,
  defineAgent,
  type ModelProvider,
  type ModelRequest,
} from "@threadlight/agent-loop";

import {
  createAttachmentRuntime,
  type AttachmentProvider,
} from "../src/attachment-runtime.js";

describe("attachment runtime", () => {
  it("uploads only after the scripted model requests the attachment", async () => {
    const requests: ModelRequest[] = [];
    let uploads = 0;
    const provider: ModelProvider & AttachmentProvider = {
      async uploadAttachment(attachment) {
        uploads += 1;
        return {
          ...attachment,
          providerReference: { protocol: "scripted", fileId: "file-1" },
        };
      },
      async generate(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            text: "I need the image.",
            toolCalls: [
              {
                id: "upload-1",
                name: "attach_to_model_context",
                arguments: { attachmentId: "attachment-1" },
              },
            ],
          };
        }
        return { text: "The image is ready.", toolCalls: [] };
      },
    };
    const attachment = {
      id: "attachment-1",
      name: "diagram.png",
      mimeType: "image/png",
      size: 5,
      kind: "image" as const,
      path: "/workspace/diagram.png",
    };
    const runtime = createAttachmentRuntime(
      provider,
      "What is shown?",
      [attachment],
    );

    await new AgentLoop(provider).run(
      defineAgent({
        name: "test",
        instructions: "Inspect the image",
        tools: runtime.tool ? [runtime.tool] : [],
      }),
      runtime.input,
      {
        ...(runtime.controller ? { controller: runtime.controller } : {}),
      },
    );

    expect(uploads).toBe(1);
    expect(requests[0]?.attachments).toBeUndefined();
    expect(requests[0]?.input).toContain("diagram.png");
    expect(requests[0]?.input).toContain("/workspace/diagram.png");
    expect(requests[1]?.attachments).toEqual([
      {
        ...attachment,
        providerReference: { protocol: "scripted", fileId: "file-1" },
      },
    ]);
  });
});
