const TASK_SEGMENT = "tasks";

export function threadIdFromTaskPath(
  pathname: string,
  basePath = "/",
): string | undefined {
  const base = normalizeBasePath(basePath);
  if (!pathname.startsWith(base)) return;
  const relative = pathname.slice(base.length).replace(/^\/+|\/+$/g, "");
  const match = /^tasks\/([^/]+)$/.exec(relative);
  if (!match) return;
  try {
    const threadId = decodeURIComponent(match[1]!);
    return threadId.trim() ? threadId : undefined;
  } catch {
    return;
  }
}

export function taskPath(
  threadId: string | undefined,
  basePath = "/",
): string {
  const base = normalizeBasePath(basePath);
  return threadId
    ? `${base}${TASK_SEGMENT}/${encodeURIComponent(threadId)}`
    : base;
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";
  return `/${trimmed.replace(/^\/+|\/+$/g, "")}/`;
}
