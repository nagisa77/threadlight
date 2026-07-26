import {
  defineTool,
  type Tool,
  type ToolContext,
} from "@threadlight/agent-loop";

export type ComputerShareMode =
  | "none"
  | "applications"
  | "windows"
  | "display";

export interface ComputerShareTarget {
  id: string;
  type: "application" | "window" | "display";
  name: string;
  applicationName?: string;
  windowTitle?: string;
  processId?: number;
  displayId?: string;
}

export interface ComputerShareState {
  mode: ComputerShareMode;
  targets: readonly ComputerShareTarget[];
  pictureInPicture: boolean;
  canvas: {
    width: number;
    height: number;
  };
  inputMode: "virtual" | "system";
  includeChildWindows?: boolean;
}

export interface ComputerShareRuntime {
  list(context: ToolContext): Promise<readonly ComputerShareTarget[]>;
  configure(
    options: {
      mode: Exclude<ComputerShareMode, "none">;
      targetIds: readonly string[];
      pictureInPicture: boolean;
      inputMode: "virtual" | "system";
    },
    context: ToolContext,
  ): Promise<ComputerShareState>;
  clear(context: ToolContext): Promise<ComputerShareState>;
}

export interface ComputerShareToolOptions {
  runtime: ComputerShareRuntime;
  needsApproval?: Tool["needsApproval"];
}

export function createComputerShareTool(
  options: ComputerShareToolOptions,
): Tool {
  return defineTool({
    name: "computer_share",
    description:
      "List and select the applications, windows, or display that the computer tool may see. Use list before set. Select only the content needed for the task. Use virtual input to avoid moving the physical mouse.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "set", "clear"],
          description:
            "List available share targets, set the active targets, or clear the current share session.",
        },
        mode: {
          type: ["string", "null"],
          enum: ["applications", "windows", "display", null],
          description: "Required for set and null for list or clear.",
        },
        target_ids: {
          type: ["array", "null"],
          items: { type: "string", minLength: 1 },
          maxItems: 12,
          description:
            "Target ids returned by list. Required and non-empty for set.",
        },
        picture_in_picture: {
          type: ["boolean", "null"],
          description:
            "Show a compact always-on-top preview. Defaults to true for set.",
        },
        input_mode: {
          type: ["string", "null"],
          enum: ["virtual", "system", null],
          description:
            "Virtual sends input directly to the selected application without moving the physical mouse. Use system only when the user explicitly permits physical cursor control.",
        },
      },
      required: [
        "action",
        "mode",
        "target_ids",
        "picture_in_picture",
        "input_mode",
      ],
      additionalProperties: false,
    },
    needsApproval: options.needsApproval ?? false,
    async execute(arguments_, context) {
      const request = parseComputerShareArguments(arguments_);
      if (request.action === "list") {
        return JSON.stringify({
          targets: await options.runtime.list(context),
          guidance:
            "Choose application ids to share all of an app's visible windows, window ids for precise capture, or one display id for desktop work.",
        });
      }
      if (request.action === "clear") {
        return JSON.stringify(await options.runtime.clear(context));
      }
      return JSON.stringify(
        await options.runtime.configure(
          {
            mode: request.mode,
            targetIds: request.targetIds,
            pictureInPicture: request.pictureInPicture,
            inputMode: request.inputMode,
          },
          context,
        ),
      );
    },
  });
}

type ParsedComputerShareArguments =
  | { action: "list" }
  | { action: "clear" }
  | {
      action: "set";
      mode: Exclude<ComputerShareMode, "none">;
      targetIds: string[];
      pictureInPicture: boolean;
      inputMode: "virtual" | "system";
    };

function parseComputerShareArguments(
  value: unknown,
): ParsedComputerShareArguments {
  if (!isObject(value)) throw new Error("computer_share arguments must be an object");
  if (
    value.action !== "list" &&
    value.action !== "set" &&
    value.action !== "clear"
  ) {
    throw new Error("action must be list, set, or clear");
  }
  if (value.action !== "set") return { action: value.action };

  if (
    value.mode !== "applications" &&
    value.mode !== "windows" &&
    value.mode !== "display"
  ) {
    throw new Error("mode is required for set");
  }
  if (
    !Array.isArray(value.target_ids) ||
    value.target_ids.length === 0 ||
    value.target_ids.length > 12 ||
    value.target_ids.some((id) => typeof id !== "string" || !id)
  ) {
    throw new Error("target_ids must contain between 1 and 12 target ids");
  }
  if (
    value.picture_in_picture !== null &&
    value.picture_in_picture !== undefined &&
    typeof value.picture_in_picture !== "boolean"
  ) {
    throw new Error("picture_in_picture must be a boolean or null");
  }
  if (
    value.input_mode !== null &&
    value.input_mode !== undefined &&
    value.input_mode !== "virtual" &&
    value.input_mode !== "system"
  ) {
    throw new Error("input_mode must be virtual, system, or null");
  }

  return {
    action: "set",
    mode: value.mode,
    targetIds: [...new Set(value.target_ids)],
    pictureInPicture: value.picture_in_picture ?? true,
    inputMode: value.input_mode ?? "virtual",
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
