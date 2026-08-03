import { describe, expect, it } from "vitest";

import { parseHostArgs } from "../src/host-cli-options.js";

describe("parseHostArgs", () => {
  it("collects every repeated --origin value", () => {
    expect(
      parseHostArgs([
        "--origin",
        "http://localhost:5173",
        "--host",
        "0.0.0.0",
        "--origin",
        "http://192.168.50.186:5173",
      ]),
    ).toMatchObject({
      host: "0.0.0.0",
      origins: [
        "http://localhost:5173",
        "http://192.168.50.186:5173",
      ],
    });
  });

  it("keeps a single --origin compatible", () => {
    expect(
      parseHostArgs(["--origin", "http://localhost:5173"]).origins,
    ).toEqual(["http://localhost:5173"]);
  });
});
