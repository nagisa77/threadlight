export function formatComputerToolInput(
  arguments_: unknown,
): string | undefined {
  if (!isObject(arguments_) || !Array.isArray(arguments_.actions)) return;
  const actions = arguments_.actions.flatMap((action, index) => {
    const detail = formatComputerAction(action);
    return detail ? [`操作 ${index + 1} · ${detail}`] : [];
  });
  return actions.length > 0 ? actions.join("\n") : undefined;
}

export function formatComputerToolResult(
  result: { output: string; isError?: boolean },
): string {
  if (result.isError) return `错误 · ${truncate(result.output)}`;
  const header = result.output.slice(0, 512);
  if (/"type"\s*:\s*"computer_screenshot"/.test(header)) {
    return "结果 · 已捕获更新后的屏幕截图";
  }
  if (header.includes("data:image/")) {
    return "结果 · 已返回屏幕图像";
  }
  return `结果 · ${truncate(result.output)}`;
}

export function appendActivityDetail(
  current: string | undefined,
  next: string | undefined,
): string | undefined {
  if (!next) return current;
  return current ? `${current}\n${next}` : next;
}

function formatComputerAction(action: unknown): string | undefined {
  if (!isObject(action) || typeof action.type !== "string") return;
  const point =
    typeof action.x === "number" && typeof action.y === "number"
      ? `坐标 (${action.x}, ${action.y})`
      : undefined;
  const keys = Array.isArray(action.keys)
    ? action.keys.filter((key): key is string => typeof key === "string")
    : [];
  switch (action.type) {
    case "click":
    case "double_click":
      return [
        action.type,
        point,
        typeof action.button === "string" ? `${action.button} 键` : undefined,
        keys.length > 0 ? `组合键 ${keys.join("+")}` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    case "move":
      return [action.type, point].filter(Boolean).join(" · ");
    case "scroll":
      return [
        action.type,
        point,
        typeof action.scroll_x === "number" &&
        typeof action.scroll_y === "number"
          ? `偏移 (${action.scroll_x}, ${action.scroll_y})`
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    case "drag": {
      const path = Array.isArray(action.path)
        ? action.path.flatMap((entry) =>
            isObject(entry) &&
            typeof entry.x === "number" &&
            typeof entry.y === "number"
              ? [{ x: entry.x, y: entry.y }]
              : [],
          )
        : [];
      const first = path[0];
      const last = path.at(-1);
      return [
        action.type,
        first && last
          ? `(${first.x}, ${first.y}) → (${last.x}, ${last.y})`
          : undefined,
        path.length > 0 ? `${path.length} 个路径点` : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "keypress":
      return [
        action.type,
        keys.length > 0 ? keys.join("+") : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    case "type":
      return [
        action.type,
        typeof action.text === "string"
          ? `${[...action.text].length} 个字符（内容未记录）`
          : undefined,
      ]
        .filter(Boolean)
        .join(" · ");
    case "wait":
      return "wait · 2 秒";
    case "screenshot":
      return "screenshot";
    default:
      return action.type.replaceAll("_", " ");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function truncate(value: string, limit = 1_200): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}
