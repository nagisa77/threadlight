import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { DevelopmentModeControl } from "../src/development-mode.js";

const developmentModeSource = readFileSync(
  new URL("../src/development-mode.tsx", import.meta.url),
  "utf8",
);

describe("DevelopmentModeControl", () => {
  it("shows the selected local mode as an accessible composer control", () => {
    const html = renderToStaticMarkup(
      <DevelopmentModeControl mode="local" onChange={vi.fn()} />,
    );

    expect(html).toContain('class="development-mode-trigger pressable local"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("本地开发");
    expect(html).toContain("lucide-laptop");
    expect(html).toContain("lucide-chevron-up");
  });

  it("makes a started worktree task confirmable but immutable", () => {
    const html = renderToStaticMarkup(
      <DevelopmentModeControl mode="worktree" disabled onChange={vi.fn()} />,
    );

    expect(html).toContain("工作树开发");
    expect(html).toContain("lucide-git-branch");
    expect(html).toContain("disabled");
  });

  it("pins the popover directly above its composer trigger", () => {
    expect(developmentModeSource).toContain('pin: "bottom"');
    expect(developmentModeSource).not.toContain("height: 174");
    expect(developmentModeSource).toContain("ActionPopoverHeading");
  });
});
