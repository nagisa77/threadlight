import { execFile } from "node:child_process";

import type { ComputerUseAction } from "@threadlight/builtin-tools";

export type RoutedComputerAction =
  | (Extract<
      ComputerUseAction,
      { type: "click" | "double_click" | "move" | "scroll" }
    > & {
      processId?: number;
    })
  | (Extract<ComputerUseAction, { type: "drag" }> & {
      processId?: number;
    })
  | (Extract<ComputerUseAction, { type: "keypress" | "type" }> & {
      processId?: number;
    });

export async function performMacOSComputerActions(
  actions: readonly RoutedComputerAction[],
  inputMode: "virtual" | "system",
  signal: AbortSignal,
): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Desktop computer input currently requires macOS");
  }
  if (actions.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    execFile(
      "/usr/bin/osascript",
      [
        "-l",
        "JavaScript",
        "-e",
        MACOS_ROUTED_INPUT_RUNNER,
        "--",
        JSON.stringify({ actions, inputMode }),
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024, signal },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

const MACOS_ROUTED_INPUT_RUNNER = String.raw`
ObjC.import("ApplicationServices");

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

function post(event, action, inputMode) {
  if (inputMode === "virtual") {
    if (!action.processId) {
      throw new Error(
        "Virtual input could not resolve the selected application's process",
      );
    }
    $.CGEventPostToPid(action.processId, event);
  } else {
    $.CGEventPost(0, event);
  }
}

function mouseEvent(type, point, button, keys) {
  const event = $.CGEventCreateMouseEvent(
    null,
    type,
    { x: point.x, y: point.y },
    button,
  );
  $.CGEventSetFlags(event, flags(keys));
  return event;
}

function postMouse(type, point, button, keys, inputMode) {
  post(mouseEvent(type, point, button, keys), point, inputMode);
}

function tryAccessibilityPress(action) {
  if (
    (action.button || "left") !== "left" ||
    (action.keys && action.keys.length)
  ) {
    return false;
  }
  const element = Ref();
  const lookup = $.AXUIElementCopyElementAtPosition(
    $.AXUIElementCreateSystemWide(),
    action.x,
    action.y,
    element,
  );
  if (Number(lookup) !== 0 || !element[0]) return false;
  const elementPid = Ref();
  if (
    Number($.AXUIElementGetPid(element[0], elementPid)) !== 0 ||
    Number(elementPid[0]) !== Number(action.processId)
  ) {
    return false;
  }
  return Number($.AXUIElementPerformAction(element[0], "AXPress")) === 0;
}

function move(action, inputMode) {
  postMouse(5, action, 0, action.keys, inputMode);
}

function click(action, count, inputMode) {
  if (inputMode === "virtual" && tryAccessibilityPress(action)) {
    if (count === 2) {
      delay(0.08);
      tryAccessibilityPress(action);
    }
    return;
  }
  const button = eventTypes[action.button || "left"];
  for (let index = 0; index < count; index += 1) {
    postMouse(button.down, action, button.button, action.keys, inputMode);
    delay(0.04);
    postMouse(button.up, action, button.button, action.keys, inputMode);
    if (index + 1 < count) delay(0.08);
  }
}

function drag(action, inputMode) {
  const button = eventTypes.left;
  const first = { ...action.path[0], processId: action.processId };
  move({ ...first, keys: action.keys }, inputMode);
  postMouse(button.down, first, button.button, action.keys, inputMode);
  for (const rawPoint of action.path.slice(1)) {
    const point = { ...rawPoint, processId: action.processId };
    delay(0.01);
    postMouse(button.drag, point, button.button, action.keys, inputMode);
  }
  const last = {
    ...action.path[action.path.length - 1],
    processId: action.processId,
  };
  postMouse(button.up, last, button.button, action.keys, inputMode);
}

function focusProcess(processId) {
  if (!processId) return;
  const process = Application("System Events").applicationProcesses.byId(
    processId,
  );
  process.frontmost = true;
  delay(0.04);
}

function keypress(action) {
  focusProcess(action.processId);
  const systemEvents = Application("System Events");
  const modifiers = action.keys
    .map((key) => modifierNames[String(key).toUpperCase()])
    .filter(Boolean);
  const ordinary = action.keys.filter(
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
  const request = JSON.parse(argv[0]);
  for (const action of request.actions) {
    switch (action.type) {
      case "click":
        click(action, 1, request.inputMode);
        break;
      case "double_click":
        click(action, 2, request.inputMode);
        break;
      case "drag":
        drag(action, request.inputMode);
        break;
      case "move":
        move(action, request.inputMode);
        break;
      case "scroll": {
        const scroll = $.CGEventCreateScrollWheelEvent(
          null,
          0,
          2,
          -Math.round(action.scroll_y),
          -Math.round(action.scroll_x),
        );
        $.CGEventSetLocation(scroll, { x: action.x, y: action.y });
        $.CGEventSetFlags(scroll, flags(action.keys));
        post(scroll, action, request.inputMode);
        break;
      }
      case "keypress":
        keypress(action);
        break;
      case "type":
        focusProcess(action.processId);
        Application("System Events").keystroke(action.text);
        break;
      default:
        throw new Error("Unsupported routed computer action: " + action.type);
    }
  }
}
`;
