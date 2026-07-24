import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ComputerShareStatus,
  shouldStopComputerShare,
} from "../src/app.js";

describe("computer share composer status", () => {
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
        onShow={vi.fn()}
      />,
    );

    expect(html).toContain("正在共享 2 个窗口");
    expect(html).toContain("Safari、Calendar");
    expect(html).toContain("重新打开");
  });

  it("ends sharing only on a running-to-idle turn transition", () => {
    expect(shouldStopComputerShare(true, false)).toBe(true);
    expect(shouldStopComputerShare(false, false)).toBe(false);
    expect(shouldStopComputerShare(true, true)).toBe(false);
  });
});
