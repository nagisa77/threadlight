export type ShortcutEvent = Pick<
  KeyboardEvent,
  "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

export function isTogglePanelShortcut(
  event: ShortcutEvent,
  options: { shiftKey?: boolean } = {},
) {
  return (
    event.key.toLowerCase() === "j" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    event.shiftKey === Boolean(options.shiftKey)
  );
}
