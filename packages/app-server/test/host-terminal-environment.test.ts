import { describe, expect, it } from "vitest";

import { hostTerminalEnvironment } from "../src/host-terminal-environment.js";

describe("hostTerminalEnvironment", () => {
  it("does not expose the Host access token to remote shells", () => {
    const source = {
      PATH: "/usr/bin",
      THREADLIGHT_HOST_TOKEN: "host-secret",
    };

    expect(hostTerminalEnvironment(source)).toEqual({
      PATH: "/usr/bin",
    });
    expect(source.THREADLIGHT_HOST_TOKEN).toBe("host-secret");
  });
});
