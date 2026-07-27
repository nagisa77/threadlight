import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ComputerShareStatus,
  ownsActiveComputerShare,
} from "../src/app.js";

describe("computer share composer status", () => {
  it("only belongs in the composer of the owning task", () => {
    const snapshot = {
      active: true,
      pictureInPicture: true,
      ownerThreadId: "thread-a",
      targets: [],
    };

    expect(ownsActiveComputerShare(snapshot, "thread-a")).toBe(true);
    expect(ownsActiveComputerShare(snapshot, "thread-b")).toBe(false);
  });

  it("offers to reopen a closed picture in picture while sharing continues", () => {
    const html = renderToStaticMarkup(
      <ComputerShareStatus
        snapshot={{
          active: true,
          pictureInPicture: false,
          targets: [
            {
              id: "window:1",
              name: "Safari — Messi",
              applicationName: "Safari",
            },
            {
              id: "window:2",
              name: "Calendar",
              applicationName: "Calendar",
            },
          ],
        }}
        busy={false}
        stopping={false}
        onShow={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(html).toContain("正在共享 2 个窗口");
    expect(html).toContain("Safari、Calendar");
    expect(html).toContain("重新打开");
    expect(html).toContain('aria-label="停止共享"');
  });

  it("keeps the explicit stop action available while the preview is open", () => {
    const html = renderToStaticMarkup(
      <ComputerShareStatus
        snapshot={{
          active: true,
          pictureInPicture: true,
          targets: [
            {
              id: "application:1",
              name: "Safari",
              applicationName: "Safari",
            },
          ],
        }}
        busy={false}
        stopping={false}
        onShow={vi.fn()}
        onStop={vi.fn()}
      />,
    );

    expect(html).toContain("显示画中画");
    expect(html).toContain('title="停止共享"');
  });
});
