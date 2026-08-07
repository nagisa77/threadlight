import type { HostProjectsSnapshot } from "@threadlight/protocol";
import { describe, expect, it } from "vitest";

import {
  clientActiveProjectId,
  createRemoteWebSession,
  IncompatibleHostProtocolError,
} from "../src/index.js";

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

describe("remote Web protocol handshake", () => {
  it("rejects an incompatible Host before requesting projects", async () => {
    const requests: string[] = [];
    const fetcher: typeof globalThis.fetch = async (input) => {
      requests.push(String(input));
      return new Response(
        JSON.stringify({
          ok: true,
          protocolVersion: 1,
          hostId: "host-old",
          name: "Old Host",
          homePath: "/host",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    };

    const error: unknown = await createRemoteWebSession({
      endpoint: "https://host.example.com",
      token: "test-token",
      fetch: fetcher,
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(IncompatibleHostProtocolError);
    if (!(error instanceof IncompatibleHostProtocolError)) return;
    expect(error).toMatchObject({
      clientProtocolVersion: 2,
      hostProtocolVersion: 1,
      upgradeTarget: "host",
    });
    expect(error.message).toContain("Web client protocol version: 2");
    expect(error.message).toContain("Host protocol version: 1");
    expect(error.message).toContain("Update the Threadlight Host");
    expect(requests).toEqual(["https://host.example.com/v1/health"]);
  });

  it("recommends upgrading the Web client for a newer Host protocol", () => {
    const error = new IncompatibleHostProtocolError(3);

    expect(error.upgradeTarget).toBe("web");
    expect(error.message).toContain("Web client protocol version: 2");
    expect(error.message).toContain("Host protocol version: 3");
    expect(error.message).toContain("Update this Threadlight Web client");
  });
});
