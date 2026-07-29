import { describe, expect, it } from "vitest";
import {
  isTaskSearchShortcut,
  isTogglePanelShortcut,
} from "../src/keyboard-shortcuts.js";

function shortcut(
  overrides: Partial<Parameters<typeof isTogglePanelShortcut>[0]> = {},
) {
  return {
    key: "j",
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("panel keyboard shortcuts", () => {
  it("uses command/control-J for the terminal", () => {
    expect(isTogglePanelShortcut(shortcut())).toBe(true);
    expect(
      isTogglePanelShortcut(shortcut({ metaKey: false, ctrlKey: true })),
    ).toBe(true);
    expect(isTogglePanelShortcut(shortcut({ shiftKey: true }))).toBe(false);
  });

  it("uses shift-command/control-J for the right panel", () => {
    expect(
      isTogglePanelShortcut(shortcut({ shiftKey: true }), { shiftKey: true }),
    ).toBe(true);
    expect(
      isTogglePanelShortcut(
        shortcut({ metaKey: false, ctrlKey: true, shiftKey: true }),
        { shiftKey: true },
      ),
    ).toBe(true);
    expect(isTogglePanelShortcut(shortcut(), { shiftKey: true })).toBe(false);
  });

  it("ignores unrelated or modified shortcuts", () => {
    expect(isTogglePanelShortcut(shortcut({ key: "k" }))).toBe(false);
    expect(isTogglePanelShortcut(shortcut({ altKey: true }))).toBe(false);
    expect(
      isTogglePanelShortcut(shortcut({ metaKey: false, ctrlKey: false })),
    ).toBe(false);
  });
});

describe("task search keyboard shortcut", () => {
  it("uses command/control-K without extra modifiers", () => {
    expect(isTaskSearchShortcut(shortcut({ key: "k" }))).toBe(true);
    expect(
      isTaskSearchShortcut(
        shortcut({ key: "K", metaKey: false, ctrlKey: true }),
      ),
    ).toBe(true);
    expect(
      isTaskSearchShortcut(shortcut({ key: "k", shiftKey: true })),
    ).toBe(false);
    expect(isTaskSearchShortcut(shortcut({ key: "j" }))).toBe(false);
  });
});
