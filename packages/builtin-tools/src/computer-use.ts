import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  defineTool,
  type Tool,
  type ToolContext,
} from "@threadlight/agent-loop";

const MAX_ACTIONS = 100;
const MAX_DRAG_POINTS = 1_000;
const MAX_TEXT_LENGTH = 100_000;
const MAX_SCREENSHOT_BYTES = 50 * 1024 * 1024;

export type ComputerUseAction =
  | {
      type: "click" | "double_click";
      x: number;
      y: number;
      button?: "left" | "right" | "wheel" | "back" | "forward";
      keys?: readonly string[];
    }
  | {
      type: "drag";
      path: readonly { x: number; y: number }[];
      keys?: readonly string[];
    }
  | {
      type: "keypress";
      keys: readonly string[];
    }
  | {
      type: "move";
      x: number;
      y: number;
      keys?: readonly string[];
    }
  | {
      type: "scroll";
      x: number;
      y: number;
      scroll_x: number;
      scroll_y: number;
      keys?: readonly string[];
    }
  | {
      type: "type";
      text: string;
    }
  | {
      type: "screenshot" | "wait";
    };

export interface ComputerUseSafetyCheck {
  id: string;
  code?: string | null;
  message?: string | null;
}

export interface ComputerUseDriver {
  execute(
    actions: readonly ComputerUseAction[],
    context: ToolContext,
  ): Promise<Uint8Array>;
}

export interface ComputerUseToolOptions {
  driver?: ComputerUseDriver;
}

interface ComputerUseArguments {
  actions: ComputerUseAction[];
  pendingSafetyChecks: ComputerUseSafetyCheck[];
}

export function createComputerUseTool(
  options: ComputerUseToolOptions = {},
): Tool {
  const driver = options.driver ?? createMacOSComputerUseDriver();

  return defineTool({
    name: "computer",
    kind: "computer",
    description:
      "Inspect and control the visible computer through screenshots, mouse actions, scrolling, typing, key presses, dragging, and waits.",
    parameters: computerUseParameters(),
    async execute(arguments_, context) {
      const parsed = parseArguments(arguments_);
      const screenshot = await driver.execute(parsed.actions, context);
      if (screenshot.byteLength === 0) {
        throw new Error(
          "Computer use captured an empty screenshot. Allow Threadlight to record the screen in System Settings, then try again.",
        );
      }

      return {
        type: "computer_screenshot",
        imageUrl: `data:image/png;base64,${Buffer.from(screenshot).toString("base64")}`,
        detail: "original",
        acknowledgedSafetyChecks: parsed.pendingSafetyChecks,
      };
    },
  });
}

export function createMacOSComputerUseDriver(): ComputerUseDriver {
  if (process.platform !== "darwin") {
    throw new Error("The built-in computer driver currently requires macOS");
  }

  return {
    async execute(actions, context) {
      context.signal.throwIfAborted();
      if (actions.some((action) => action.type !== "screenshot")) {
        try {
          await execFileText(
            "/usr/bin/osascript",
            [
              "-l",
              "JavaScript",
              "-e",
              MACOS_ACTION_RUNNER,
              "--",
              JSON.stringify(actions),
            ],
            context.signal,
          );
        } catch (error) {
          throw computerPermissionError(error);
        }
      }

      context.signal.throwIfAborted();
      try {
        return await captureMainScreen(context.signal);
      } catch (error) {
        throw computerPermissionError(error);
      }
    },
  };
}

function computerUseParameters() {
  const coordinate = { type: "number", minimum: 0, maximum: 100_000 };
  const keys = {
    type: ["array", "null"],
    items: { type: "string", minLength: 1 },
    maxItems: 20,
  };

  return {
    type: "object",
    properties: {
      actions: {
        type: "array",
        minItems: 1,
        maxItems: MAX_ACTIONS,
        description:
          "UI actions to execute in order before returning an updated screenshot.",
        items: {
          oneOf: [
            {
              type: "object",
              properties: {
                type: { const: "click" },
                x: coordinate,
                y: coordinate,
                button: {
                  type: ["string", "null"],
                  enum: [
                    "left",
                    "right",
                    "wheel",
                    "back",
                    "forward",
                    null,
                  ],
                },
                keys,
              },
              required: ["type", "x", "y", "button", "keys"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "double_click" },
                x: coordinate,
                y: coordinate,
                button: {
                  type: ["string", "null"],
                  enum: [
                    "left",
                    "right",
                    "wheel",
                    "back",
                    "forward",
                    null,
                  ],
                },
                keys,
              },
              required: ["type", "x", "y", "button", "keys"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "drag" },
                path: {
                  type: "array",
                  minItems: 2,
                  maxItems: MAX_DRAG_POINTS,
                  items: {
                    type: "object",
                    properties: { x: coordinate, y: coordinate },
                    required: ["x", "y"],
                    additionalProperties: false,
                  },
                },
                keys,
              },
              required: ["type", "path", "keys"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "keypress" },
                keys: {
                  type: "array",
                  minItems: 1,
                  maxItems: 20,
                  items: { type: "string", minLength: 1 },
                },
              },
              required: ["type", "keys"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "move" },
                x: coordinate,
                y: coordinate,
                keys,
              },
              required: ["type", "x", "y", "keys"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "scroll" },
                x: coordinate,
                y: coordinate,
                scroll_x: { type: "number", minimum: -100_000, maximum: 100_000 },
                scroll_y: { type: "number", minimum: -100_000, maximum: 100_000 },
                keys,
              },
              required: [
                "type",
                "x",
                "y",
                "scroll_x",
                "scroll_y",
                "keys",
              ],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { const: "type" },
                text: { type: "string", maxLength: MAX_TEXT_LENGTH },
              },
              required: ["type", "text"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                type: { enum: ["screenshot", "wait"] },
              },
              required: ["type"],
              additionalProperties: false,
            },
          ],
        },
      },
      pendingSafetyChecks: {
        type: ["array", "null"],
        maxItems: 100,
        description:
          "OpenAI safety checks attached to this action batch. Include them unchanged so execution can acknowledge them.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", minLength: 1 },
            code: { type: ["string", "null"] },
            message: { type: ["string", "null"] },
          },
          required: ["id", "code", "message"],
          additionalProperties: false,
        },
      },
    },
    required: ["actions", "pendingSafetyChecks"],
    additionalProperties: false,
  };
}

function parseArguments(value: unknown): ComputerUseArguments {
  if (!isObject(value)) throw new Error("arguments must be an object");
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error("actions must be a non-empty array");
  }
  if (value.actions.length > MAX_ACTIONS) {
    throw new Error(`actions cannot contain more than ${MAX_ACTIONS} items`);
  }

  const safetyChecksValue = value.pendingSafetyChecks;
  if (
    safetyChecksValue !== undefined &&
    safetyChecksValue !== null &&
    !Array.isArray(safetyChecksValue)
  ) {
    throw new Error("pendingSafetyChecks must be an array");
  }
  const safetyChecks = (safetyChecksValue ?? []).map(parseSafetyCheck);

  return {
    actions: value.actions.map(parseAction),
    pendingSafetyChecks: safetyChecks,
  };
}

function parseAction(value: unknown): ComputerUseAction {
  if (!isObject(value) || typeof value.type !== "string") {
    throw new Error("each computer action must be an object with a type");
  }

  switch (value.type) {
    case "click":
    case "double_click":
      return {
        type: value.type,
        x: coordinate(value.x, "x"),
        y: coordinate(value.y, "y"),
        button: mouseButton(value.button),
        keys: optionalKeys(value.keys),
      };
    case "drag": {
      if (
        !Array.isArray(value.path) ||
        value.path.length < 2 ||
        value.path.length > MAX_DRAG_POINTS
      ) {
        throw new Error(
          `drag path must contain between 2 and ${MAX_DRAG_POINTS} points`,
        );
      }
      return {
        type: "drag",
        path: value.path.map((point) => {
          if (!isObject(point)) throw new Error("drag points must be objects");
          return {
            x: coordinate(point.x, "x"),
            y: coordinate(point.y, "y"),
          };
        }),
        keys: optionalKeys(value.keys),
      };
    }
    case "keypress":
      return {
        type: "keypress",
        keys: requiredKeys(value.keys),
      };
    case "move":
      return {
        type: "move",
        x: coordinate(value.x, "x"),
        y: coordinate(value.y, "y"),
        keys: optionalKeys(value.keys),
      };
    case "scroll":
      return {
        type: "scroll",
        x: coordinate(value.x, "x"),
        y: coordinate(value.y, "y"),
        scroll_x: distance(value.scroll_x, "scroll_x"),
        scroll_y: distance(value.scroll_y, "scroll_y"),
        keys: optionalKeys(value.keys),
      };
    case "type":
      if (
        typeof value.text !== "string" ||
        value.text.length > MAX_TEXT_LENGTH
      ) {
        throw new Error(
          `type text must be a string no longer than ${MAX_TEXT_LENGTH} characters`,
        );
      }
      return { type: "type", text: value.text };
    case "screenshot":
    case "wait":
      return { type: value.type };
    default:
      throw new Error(`unsupported computer action: ${value.type}`);
  }
}

function parseSafetyCheck(value: unknown): ComputerUseSafetyCheck {
  if (!isObject(value) || typeof value.id !== "string" || !value.id) {
    throw new Error("each pending safety check must have an id");
  }
  return {
    id: value.id,
    ...(typeof value.code === "string" || value.code === null
      ? { code: value.code }
      : {}),
    ...(typeof value.message === "string" || value.message === null
      ? { message: value.message }
      : {}),
  };
}

function coordinate(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100_000
  ) {
    throw new Error(`${name} must be a finite coordinate`);
  }
  return value;
}

function distance(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 100_000
  ) {
    throw new Error(`${name} must be a finite scroll distance`);
  }
  return value;
}

function mouseButton(
  value: unknown,
): "left" | "right" | "wheel" | "back" | "forward" {
  if (value === undefined || value === null) return "left";
  if (
    value === "left" ||
    value === "right" ||
    value === "wheel" ||
    value === "back" ||
    value === "forward"
  ) {
    return value;
  }
  throw new Error("button must be left, right, wheel, back, or forward");
}

function optionalKeys(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return;
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((key) => typeof key !== "string" || key.length === 0)
  ) {
    throw new Error("keys must be an array of key names");
  }
  return value;
}

function requiredKeys(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 20 ||
    value.some((key) => typeof key !== "string" || key.length === 0)
  ) {
    throw new Error("keys must be a non-empty array of key names");
  }
  return value;
}

function execFileText(
  file: string,
  arguments_: readonly string[],
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      [...arguments_],
      { encoding: "utf8", maxBuffer: 1024 * 1024, signal },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

async function captureMainScreen(
  signal: AbortSignal,
): Promise<Buffer> {
  const directory = await mkdtemp(
    join(tmpdir(), "threadlight-computer-use-"),
  );
  const screenshotPath = join(directory, "screen.png");
  try {
    await execFileText(
      "/usr/sbin/screencapture",
      ["-x", "-D", "1", "-t", "png", screenshotPath],
      signal,
    );
    const screenshot = await readFile(screenshotPath);
    if (screenshot.byteLength > MAX_SCREENSHOT_BYTES) {
      throw new Error(
        `Computer screenshot exceeded ${MAX_SCREENSHOT_BYTES} bytes`,
      );
    }
    return screenshot;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function computerPermissionError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (
    /assistive access|not authorized|not permitted|permission/i.test(message)
  ) {
    return new Error(
      "Computer use needs Accessibility and Screen Recording permission for Threadlight in System Settings.",
    );
  }
  return error instanceof Error ? error : new Error(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const MACOS_ACTION_RUNNER = String.raw`
ObjC.import("ApplicationServices");
ObjC.import("AppKit");

const screenScale = Math.max(
  1,
  Number($.NSScreen.mainScreen.backingScaleFactor),
);

const eventTypes = {
  left: { down: 1, up: 2, drag: 6, button: 0 },
  right: { down: 3, up: 4, drag: 7, button: 1 },
  wheel: { down: 25, up: 26, drag: 27, button: 2 },
  back: { down: 25, up: 26, drag: 27, button: 3 },
  forward: { down: 25, up: 26, drag: 27, button: 4 },
};

const modifierFlags = {
  SHIFT: 1 << 17,
  CTRL: 1 << 18,
  CONTROL: 1 << 18,
  ALT: 1 << 19,
  OPTION: 1 << 19,
  META: 1 << 20,
  CMD: 1 << 20,
  COMMAND: 1 << 20,
};

const modifierNames = {
  SHIFT: "shift down",
  CTRL: "control down",
  CONTROL: "control down",
  ALT: "option down",
  OPTION: "option down",
  META: "command down",
  CMD: "command down",
  COMMAND: "command down",
};

const keyCodes = {
  ENTER: 36,
  RETURN: 36,
  TAB: 48,
  SPACE: 49,
  BACKSPACE: 51,
  ESC: 53,
  ESCAPE: 53,
  HOME: 115,
  PAGEUP: 116,
  DELETE: 117,
  DEL: 117,
  END: 119,
  PAGEDOWN: 121,
  LEFT: 123,
  ARROWLEFT: 123,
  RIGHT: 124,
  ARROWRIGHT: 124,
  DOWN: 125,
  ARROWDOWN: 125,
  UP: 126,
  ARROWUP: 126,
};

function flags(keys) {
  return (keys || []).reduce(
    (value, key) => value | (modifierFlags[String(key).toUpperCase()] || 0),
    0,
  );
}

function postMouse(type, point, button, keys) {
  const event = $.CGEventCreateMouseEvent(
    null,
    type,
    { x: point.x / screenScale, y: point.y / screenScale },
    button,
  );
  $.CGEventSetFlags(event, flags(keys));
  $.CGEventPost(0, event);
}

function move(point, keys) {
  postMouse(5, point, 0, keys);
}

function click(action, count) {
  const button = eventTypes[action.button || "left"];
  for (let index = 0; index < count; index += 1) {
    postMouse(button.down, action, button.button, action.keys);
    delay(0.04);
    postMouse(button.up, action, button.button, action.keys);
    if (index + 1 < count) delay(0.08);
  }
}

function drag(action) {
  const button = eventTypes.left;
  const first = action.path[0];
  move(first, action.keys);
  postMouse(button.down, first, button.button, action.keys);
  for (const point of action.path.slice(1)) {
    delay(0.01);
    postMouse(button.drag, point, button.button, action.keys);
  }
  postMouse(
    button.up,
    action.path[action.path.length - 1],
    button.button,
    action.keys,
  );
}

function keypress(keys) {
  const systemEvents = Application("System Events");
  const modifiers = keys
    .map((key) => modifierNames[String(key).toUpperCase()])
    .filter(Boolean);
  const ordinary = keys.filter(
    (key) => !modifierNames[String(key).toUpperCase()],
  );
  for (const key of ordinary) {
    const normalized = String(key).toUpperCase();
    if (keyCodes[normalized] !== undefined) {
      systemEvents.keyCode(keyCodes[normalized], { using: modifiers });
    } else {
      systemEvents.keystroke(String(key).toLowerCase(), { using: modifiers });
    }
  }
}

function run(argv) {
  const actions = JSON.parse(argv[0]);
  const systemEvents = Application("System Events");

  for (const action of actions) {
    switch (action.type) {
      case "click":
        click(action, 1);
        break;
      case "double_click":
        click(action, 2);
        break;
      case "drag":
        drag(action);
        break;
      case "keypress":
        keypress(action.keys);
        break;
      case "move":
        move(action, action.keys);
        break;
      case "scroll":
        move(action, action.keys);
        const scroll = $.CGEventCreateScrollWheelEvent(
          null,
          0,
          2,
          -Math.round(action.scroll_y / screenScale),
          -Math.round(action.scroll_x / screenScale),
        );
        $.CGEventSetFlags(scroll, flags(action.keys));
        $.CGEventPost(0, scroll);
        break;
      case "type":
        systemEvents.keystroke(action.text);
        break;
      case "wait":
        delay(2);
        break;
      case "screenshot":
        break;
      default:
        throw new Error("Unsupported computer action: " + action.type);
    }
  }
}
`;
