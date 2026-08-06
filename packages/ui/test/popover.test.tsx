import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { FolderOpen, Pin } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import {
  ActionPopover,
  ActionPopoverItem,
  anchoredPopoverPosition,
} from "../src/popover.js";

const popoverSource = readFileSync(
  new URL("../src/popover.tsx", import.meta.url),
  "utf8",
);

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

  it("stays above its trigger when placement is forced to top", () => {
    expect(
      anchoredPopoverPosition(
        { top: 300, right: 260, bottom: 326 },
        {
          width: 218,
          height: 190,
          viewportWidth: 800,
          viewportHeight: 600,
          placement: "top",
        },
      ),
    ).toEqual({
      top: 104,
      left: 42,
      transformOrigin: "bottom right",
    });
  });

  it("stays below its trigger when placement is forced to bottom", () => {
    expect(
      anchoredPopoverPosition(
        { top: 300, right: 260, bottom: 326 },
        {
          width: 218,
          height: 190,
          viewportWidth: 800,
          viewportHeight: 600,
          placement: "bottom",
        },
      ),
    ).toEqual({
      top: 332,
      left: 42,
      transformOrigin: "top right",
    });
  });

  it("keeps a forced-top popover inside the top viewport margin", () => {
    expect(
      anchoredPopoverPosition(
        { top: 40, right: 260, bottom: 66 },
        {
          width: 218,
          height: 190,
          viewportWidth: 800,
          viewportHeight: 600,
          placement: "top",
        },
      ),
    ).toEqual({
      top: 8,
      left: 42,
      transformOrigin: "bottom right",
    });
  });

  it("portals viewport-positioned popovers outside transformed ancestors", () => {
    expect(popoverSource).toMatch(
      /createPortal\(popover,\s*document\.body\)/,
    );
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
