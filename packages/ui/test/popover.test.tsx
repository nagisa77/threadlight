import { renderToStaticMarkup } from "react-dom/server";
import { FolderOpen, Pin } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import {
  ActionPopover,
  ActionPopoverItem,
  anchoredPopoverPosition,
} from "../src/popover.js";

describe("ActionPopover", () => {
  it("positions below its trigger when space is available", () => {
    expect(
      anchoredPopoverPosition(
        { top: 40, right: 260, bottom: 66 },
        {
          width: 218,
          height: 190,
          viewportWidth: 800,
          viewportHeight: 600,
        },
      ),
    ).toEqual({
      top: 72,
      left: 42,
      transformOrigin: "top right",
    });
  });

  it("flips above its trigger and stays inside viewport margins", () => {
    expect(
      anchoredPopoverPosition(
        { top: 500, right: 120, bottom: 526 },
        {
          width: 218,
          height: 190,
          viewportWidth: 800,
          viewportHeight: 540,
        },
      ),
    ).toEqual({
      top: 304,
      left: 8,
      transformOrigin: "bottom right",
    });
  });

  it("can align a shared popover to the start of its trigger", () => {
    expect(
      anchoredPopoverPosition(
        { top: 40, right: 360, bottom: 66, left: 280 },
        {
          width: 320,
          height: 240,
          viewportWidth: 900,
          viewportHeight: 600,
          align: "start",
        },
      ),
    ).toEqual({
      top: 72,
      left: 280,
      transformOrigin: "top left",
    });
  });

  it("renders a reusable accessible menu surface", () => {
    const html = renderToStaticMarkup(
      <ActionPopover
        label="管理项目"
        position={{
          top: 80,
          left: 20,
          transformOrigin: "top right",
        }}
        onClose={vi.fn()}
      >
        <ActionPopoverItem icon={<FolderOpen />} onSelect={vi.fn()}>
          在 Finder 中显示
        </ActionPopoverItem>
        <ActionPopoverItem icon={<Pin />} onSelect={vi.fn()}>
          置顶项目
        </ActionPopoverItem>
      </ActionPopover>,
    );

    expect(html).toContain('class="action-popover"');
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain("在 Finder 中显示");
    expect(html).toContain("置顶项目");
    expect(html).toContain("transform-origin:top right");
  });
});
