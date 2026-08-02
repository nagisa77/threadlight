import type { HostProjectsSnapshot } from "@threadlight/protocol";
import { describe, expect, it } from "vitest";

import { clientActiveProjectId } from "../src/index.js";

const snapshot: HostProjectsSnapshot = {
  activeProjectId: "host-active",
  projects: [
    {
      id: "host-active",
      name: "Host active",
      basePath: "/host-active",
      lastOpenedAt: "2026-08-02T00:00:00.000Z",
      conversations: [],
    },
    {
      id: "client-active",
      name: "Client active",
      basePath: "/client-active",
      lastOpenedAt: "2026-08-02T00:00:00.000Z",
      conversations: [],
    },
  ],
};

describe("remote Web project routing", () => {
  it("keeps the client project when the Host active project differs", () => {
    expect(clientActiveProjectId(snapshot, "client-active")).toBe(
      "client-active",
    );
  });

  it("uses the Host value only as an initial compatibility default", () => {
    expect(clientActiveProjectId(snapshot)).toBe("host-active");
    expect(clientActiveProjectId(snapshot, "missing")).toBe("host-active");
  });
});
