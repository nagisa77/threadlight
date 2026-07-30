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

export function isCommandPaletteShortcut(event: ShortcutEvent) {
  return (
    event.key.toLowerCase() === "k" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}

export const isTaskSearchShortcut = isCommandPaletteShortcut;

export function isFileSearchShortcut(event: ShortcutEvent) {
  return (
    event.key.toLowerCase() === "p" &&
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey
  );
}
