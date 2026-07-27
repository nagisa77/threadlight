import OpenAI from "openai";
import { createReadStream } from "node:fs";
import { extname } from "node:path";

import type {
  ModelGenerateOptions,
  ModelAttachment,
  ModelProvider,
  ModelRequest,
  ModelTurn,
} from "@threadlight/agent-loop";

export interface OpenAIResponsesProviderOptions {
  apiKey?: string;
  defaultModel?: string;
  client?: OpenAI;
}

const OPENAI_IMAGE_EXTENSIONS = [
  ".jpeg",
  ".jpg",
  ".png",
  ".gif",
  ".webp",
] as const;

const OPENAI_CONTEXT_FILE_EXTENSIONS = [
  ".art",
  ".bat",
  ".brf",
  ".c",
  ".cls",
  ".css",
  ".csv",
  ".diff",
  ".doc",
  ".docx",
  ".dot",
  ".eml",
  ".es",
  ".h",
  ".hs",
  ".htm",
  ".html",
  ".hwp",
  ".hwpx",
  ".ics",
  ".ifb",
  ".java",
  ".js",
  ".json",
  ".keynote",
  ".ksh",
  ".ltx",
  ".mail",
  ".markdown",
  ".md",
  ".mht",
  ".mhtml",
  ".mjs",
  ".nws",
  ".odt",
  ".pages",
  ".patch",
  ".pdf",
  ".pl",
  ".pm",
  ".pot",
  ".potm",
  ".potx",
  ".ppa",
  ".pps",
  ".ppsm",
  ".ppsx",
  ".ppt",
  ".pptm",
  ".pptx",
  ".pwz",
  ".py",
  ".rst",
  ".rtf",
  ".scala",
  ".sh",
  ".shtml",
  ".srt",
  ".sty",
  ".svg",
  ".svgz",
  ".tex",
  ".text",
  ".txt",
  ".tsv",
  ".vcf",
  ".vtt",
  ".wiz",
  ".xla",
  ".xlb",
  ".xlc",
  ".xlm",
  ".xls",
  ".xlsx",
  ".xlt",
  ".xlw",
  ".xml",
  ".yaml",
  ".yml",
] as const;

export class OpenAIResponsesProvider implements ModelProvider {
  private readonly client: OpenAI;
  private readonly defaultModel: string;

  constructor(options: OpenAIResponsesProviderOptions = {}) {
    this.client =
      options.client ??
      new OpenAI({
        apiKey: options.apiKey,
      });
    this.defaultModel = options.defaultModel ?? "gpt-5.6-sol";
  }

  validateAttachment(attachment: ModelAttachment): void {
    const extension = extname(attachment.name);
    const supported =
      attachment.kind === "image"
        ? OPENAI_IMAGE_EXTENSIONS
        : OPENAI_CONTEXT_FILE_EXTENSIONS;

    if (!(supported as readonly string[]).includes(extension)) {
      const expected =
        attachment.kind === "image"
          ? "image type"
          : "context stuffing file type";
      throw new Error(
        `Expected ${expected} to be a supported format: ${supported.join(", ")} but got ${extension || "no file extension"}.`,
      );
    }
  }

  async uploadAttachment(
    attachment: ModelAttachment,
    signal?: AbortSignal,
  ): Promise<ModelAttachment> {
    this.validateAttachment(attachment);
    if (openAIFileId(attachment.providerReference)) return attachment;
    const params: OpenAI.FileCreateParams = {
      file: createReadStream(attachment.path),
      purpose: "user_data",
    };
    const uploaded = signal
      ? await this.client.files.create(params, { signal })
      : await this.client.files.create(params);
    return {
      ...attachment,
      providerReference: {
        protocol: "openai-files",
        fileId: uploaded.id,
      },
    };
  }

  prepareStateForPersistence(
    state: unknown,
    options: { maxBytes: number },
  ): unknown {
    if (!Array.isArray(state)) return state;
    return compactResponseState(state, options.maxBytes);
  }

  async generate(
    request: ModelRequest,
    options: ModelGenerateOptions = {},
  ): Promise<ModelTurn> {
    const input: OpenAI.Responses.ResponseInput = Array.isArray(request.state)
      ? sanitizeResponseInput(request.state)
      : [];

    for (const result of request.toolResults ?? []) {
      const tool = request.tools.find(
        (candidate) => candidate.name === result.name,
      );
      if (tool?.kind === "computer") {
        if (result.isError) {
          input.push(
            computerCallErrorOutput(
              result.callId,
              input,
            ),
          );
          input.push({
            role: "developer",
            content:
              "The computer tool returned a recoverable execution error: " +
              `${truncateToolError(result.output)}. ` +
              "Inspect the error and use the available tools to recover, " +
              "including computer_share list/set when sharing is missing or stale. " +
              "Do not end the turn solely because this tool call failed.",
          });
          continue;
        }
        input.push(computerCallOutput(result.callId, result.output));
      } else {
        input.push({
          type: "function_call_output",
          call_id: result.callId,
          output: result.output,
        });
      }
    }

    if (request.attachments?.length) {
      const content: OpenAI.Responses.ResponseInputContent[] = [];
      if (request.input) {
        content.push({ type: "input_text", text: request.input });
      }
      for (const attachment of request.attachments ?? []) {
        const prepared = await this.uploadAttachment(
          attachment,
          request.signal,
        );
        const fileId = openAIFileId(prepared.providerReference);
        if (!fileId) throw new Error("OpenAI file upload did not return an id");
        content.push(
          attachment.kind === "image"
            ? {
                type: "input_image",
                detail: "auto",
                file_id: fileId,
              }
            : {
                type: "input_file",
                file_id: fileId,
              },
        );
      }
      input.push({ role: "user", content });
    } else if (request.input) {
      input.push({ role: "user", content: request.input });
    }

    const tools: OpenAI.Responses.Tool[] = request.tools.map((tool) =>
      tool.kind === "computer"
        ? { type: "computer" }
        : {
            type: "function",
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
            strict: isStrictCompatible(tool.parameters),
          },
    );

    const params = {
      model: request.model ?? this.defaultModel,
      instructions: request.instructions,
      input,
      tools,
    };

    const stream = request.signal
      ? this.client.responses.stream(params, { signal: request.signal })
      : this.client.responses.stream(params);
    stream.on("response.output_text.delta", (event) => {
      options.onEvent?.({
        type: "output_text.delta",
        delta: event.delta,
      });
    });
    const response = await stream.finalResponse();
    const output = sanitizeResponseInput(response.output);

    return {
      text: response.output_text,
      toolCalls: response.output.flatMap((item) => {
        if (item.type === "function_call") {
          return [
            {
              id: item.call_id,
              name: item.name,
              arguments: JSON.parse(item.arguments) as unknown,
            },
          ];
        }
        if (item.type === "computer_call") {
          const computerTool = request.tools.find(
            (tool) => tool.kind === "computer",
          );
          return [
            {
              id: item.call_id,
              name: computerTool?.name ?? "computer",
              arguments: {
                actions: item.actions ?? (item.action ? [item.action] : []),
                pendingSafetyChecks: item.pending_safety_checks ?? [],
              },
            },
          ];
        }
        return [];
      }),
      state: [...input, ...output],
      usage: response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }
}

const EMPTY_COMPUTER_SCREENSHOT =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function computerCallErrorOutput(
  callId: string,
  input: OpenAI.Responses.ResponseInput,
): OpenAI.Responses.ResponseInputItem {
  return {
    type: "computer_call_output",
    call_id: callId,
    status: "incomplete",
    output: {
      type: "computer_screenshot",
      image_url: EMPTY_COMPUTER_SCREENSHOT,
    },
    acknowledged_safety_checks: computerCallSafetyChecks(input, callId),
  } as OpenAI.Responses.ResponseInputItem;
}

function computerCallSafetyChecks(
  input: OpenAI.Responses.ResponseInput,
  callId: string,
): Array<{ id: string; code?: string | null; message?: string | null }> {
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = input[index];
    if (
      isObject(item) &&
      item.type === "computer_call" &&
      item.call_id === callId &&
      Array.isArray(item.pending_safety_checks)
    ) {
      return item.pending_safety_checks.filter(isSafetyCheck);
    }
  }
  return [];
}

function truncateToolError(value: string, limit = 2_000): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function computerCallOutput(
  callId: string,
  serializedOutput: string,
): OpenAI.Responses.ResponseInputItem {
  let value: unknown;
  try {
    value = JSON.parse(serializedOutput) as unknown;
  } catch {
    throw new Error("Computer tool returned invalid JSON");
  }
  if (
    !isObject(value) ||
    value.type !== "computer_screenshot" ||
    typeof value.imageUrl !== "string" ||
    !value.imageUrl.startsWith("data:image/png;base64,")
  ) {
    throw new Error("Computer tool did not return a PNG screenshot");
  }

  const safetyChecks = Array.isArray(value.acknowledgedSafetyChecks)
    ? value.acknowledgedSafetyChecks.filter(isSafetyCheck)
    : [];

  return {
    type: "computer_call_output",
    call_id: callId,
    output: {
      type: "computer_screenshot",
      image_url: value.imageUrl,
      detail: value.detail === "original" ? "original" : undefined,
    },
    acknowledged_safety_checks: safetyChecks,
  } as unknown as OpenAI.Responses.ResponseInputItem;
}

function isSafetyCheck(
  value: unknown,
): value is { id: string; code?: string | null; message?: string | null } {
  return isObject(value) && typeof value.id === "string" && value.id.length > 0;
}

function openAIFileId(value: unknown): string | undefined {
  if (!isObject(value)) return;
  return value.protocol === "openai-files" && typeof value.fileId === "string"
    ? value.fileId
    : undefined;
}

function sanitizeResponseInput(
  items: readonly unknown[],
): OpenAI.Responses.ResponseInput {
  return items.map((item) => {
    if (!isObject(item)) return item;

    if (item.type === "function_call") {
      const { parsed_arguments: _parsedArguments, ...wireItem } = item;
      return wireItem;
    }

    if (item.type === "message" && Array.isArray(item.content)) {
      return {
        ...item,
        content: item.content.map((content) => {
          if (!isObject(content) || content.type !== "output_text") {
            return content;
          }
          const { parsed: _parsed, ...wireContent } = content;
          return wireContent;
        }),
      };
    }

    return item;
  }) as OpenAI.Responses.ResponseInput;
}

function compactResponseState(
  state: readonly unknown[],
  maxBytes: number,
): OpenAI.Responses.ResponseInput {
  let compacted = sanitizePersistedResponseInput(state);
  while (serializedBytes(compacted) > maxBytes) {
    const userIndexes = compacted.flatMap((item, index) =>
      isTurnBoundary(item) ? [index] : [],
    );
    if (userIndexes.length < 2) break;
    compacted = compacted.slice(userIndexes[1]);
  }
  if (serializedBytes(compacted) > maxBytes) {
    compacted = compacted.filter(
      (item) => !isObject(item) || item.type !== "reasoning",
    ) as OpenAI.Responses.ResponseInput;
  }
  return compacted;
}

function isTurnBoundary(item: unknown): boolean {
  return (
    isObject(item) &&
    item.role === "user" &&
    typeof item.content === "string"
  );
}

function sanitizePersistedResponseInput(
  state: readonly unknown[],
): OpenAI.Responses.ResponseInput {
  return sanitizeResponseInput(state).map((item) => {
    if (!isObject(item) || item.type !== "computer_call_output") return item;
    if (!isObject(item.output)) return item;
    return {
      ...item,
      output: {
        ...item.output,
        image_url: EMPTY_COMPUTER_SCREENSHOT,
      },
    } as OpenAI.Responses.ResponseInputItem;
  }) as OpenAI.Responses.ResponseInput;
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStrictCompatible(schema: unknown): boolean {
  if (!isObject(schema)) return false;

  const variants = ["anyOf", "oneOf", "allOf"] as const;
  for (const key of variants) {
    const value = schema[key];
    if (
      value !== undefined &&
      (!Array.isArray(value) || !value.every(isStrictCompatible))
    ) {
      return false;
    }
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.includes("object")) {
    if (schema.additionalProperties !== false) return false;
    const properties = schema.properties;
    if (!isObject(properties)) return false;
    const required = schema.required;
    if (
      !Array.isArray(required) ||
      !Object.keys(properties).every((name) => required.includes(name))
    ) {
      return false;
    }
    if (!Object.values(properties).every(isStrictCompatible)) return false;
  }

  if (types.includes("array")) {
    if (!isStrictCompatible(schema.items)) return false;
  }

  return true;
}
