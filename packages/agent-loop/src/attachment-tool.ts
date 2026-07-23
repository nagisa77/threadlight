import type { ModelAttachment, ModelProvider, Tool } from "./types.js";

export const ATTACH_TO_MODEL_CONTEXT_TOOL = "attach_to_model_context";

export interface AttachmentDelivery {
  pending: ModelAttachment[];
}

export function createAttachmentContextTool(
  provider: ModelProvider,
  attachments: readonly ModelAttachment[],
  delivery: AttachmentDelivery,
): Tool | undefined {
  if (attachments.length === 0) return;
  const available = new Map(
    attachments.map((attachment) => [attachment.id, attachment]),
  );
  const uploaded = new Map<string, ModelAttachment>();

  return {
    name: ATTACH_TO_MODEL_CONTEXT_TOOL,
    description:
      "Attach one user-provided local attachment to the model context. Call this only when you need the model to inspect the file or image contents directly; local file operations should use the listed path instead.",
    parameters: {
      type: "object",
      properties: {
        attachmentId: {
          type: "string",
          description: "The attachment id listed in the user message.",
        },
      },
      required: ["attachmentId"],
      additionalProperties: false,
    },
    execute: async (arguments_, context) => {
      const attachmentId = attachmentIdFrom(arguments_);
      const attachment = available.get(attachmentId);
      if (!attachment) {
        throw new Error(`Unknown attachment: ${attachmentId}`);
      }
      const cached = uploaded.get(attachmentId);
      if (cached) {
        return {
          attachmentId,
          name: cached.name,
          status: "already_attached",
        };
      }
      if (!provider.uploadAttachment) {
        throw new Error("The active model provider does not support attachments");
      }
      const prepared = await provider.uploadAttachment(attachment, context.signal);
      if (prepared.providerReference === undefined) {
        throw new Error("The model provider did not return an attachment reference");
      }
      uploaded.set(attachmentId, prepared);
      delivery.pending.push(prepared);
      return {
        attachmentId,
        name: prepared.name,
        mimeType: prepared.mimeType,
        status: "attached",
      };
    },
  };
}

export function attachmentPrompt(
  input: string,
  attachments: readonly ModelAttachment[],
): string {
  if (attachments.length === 0) return input;
  const inventory = attachments
    .map(
      (attachment) =>
        `- id=${JSON.stringify(attachment.id)} name=${JSON.stringify(attachment.name)} mimeType=${JSON.stringify(attachment.mimeType)} size=${attachment.size} path=${JSON.stringify(attachment.path)}`,
    )
    .join("\n");
  return `${input}\n\nLocal attachments are available. Use the listed path for local file operations. Call ${ATTACH_TO_MODEL_CONTEXT_TOOL} only when you need the model to inspect the attachment contents directly.\n${inventory}`;
}

function attachmentIdFrom(arguments_: unknown): string {
  if (!arguments_ || typeof arguments_ !== "object" || Array.isArray(arguments_)) {
    throw new Error("attachmentId is required");
  }
  const attachmentId = (arguments_ as Record<string, unknown>).attachmentId;
  if (typeof attachmentId !== "string" || !attachmentId) {
    throw new Error("attachmentId is required");
  }
  return attachmentId;
}
