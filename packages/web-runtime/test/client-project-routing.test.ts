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
      clientProtocolVersion: 4,
      hostProtocolVersion: 1,
      upgradeTarget: "host",
    });
    expect(error.message).toContain("Web client protocol version: 4");
    expect(error.message).toContain("Host protocol version: 1");
    expect(error.message).toContain("Update the Threadlight Host");
    expect(requests).toEqual(["https://host.example.com/v1/health"]);
  });

  it("recommends upgrading the Web client for a newer Host protocol", () => {
    const error = new IncompatibleHostProtocolError(5);

    expect(error.upgradeTarget).toBe("web");
    expect(error.message).toContain("Web client protocol version: 4");
    expect(error.message).toContain("Host protocol version: 5");
    expect(error.message).toContain("Update this Threadlight Web client");
  });

  it("prefetches one coherent project and settings snapshot for first paint", async () => {
    const requests: string[] = [];
    const settings = {
      language: "zh-CN",
      theme: "dark",
      preferredProjectOpener: "",
      provider: "openai",
      openAIApiKeyConfigured: true,
      deepSeekApiKeyConfigured: false,
      qwenApiKeyConfigured: false,
      kimiApiKeyConfigured: false,
      doubaoApiKeyConfigured: false,
      geminiApiKeyConfigured: false,
      grokApiKeyConfigured: false,
      customApiKeyConfigured: false,
      searchProvider: "brave",
      searchApiKeyConfigured: false,
      linkupApiKeyConfigured: false,
      qwenBaseUrl: "https://dashscope.example/v1",
      kimiBaseUrl: "https://kimi.example/v1",
      doubaoBaseUrl: "https://doubao.example/v1",
      geminiBaseUrl: "https://gemini.example/v1",
      grokBaseUrl: "https://grok.example/v1",
      customBaseUrl: "http://localhost:11434/v1",
      customModel: "llama3.2",
      model: "gpt-5.6-sol",
    } as const;
    const fetcher: typeof globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      const payload = url.endsWith("/v1/health")
        ? {
            ok: true,
            protocolVersion: 4,
            hostId: "host-current",
            name: "Current Host",
            homePath: "/host",
          }
        : url.endsWith("/v1/host/projects")
          ? snapshot
          : settings;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const session = await createRemoteWebSession({
      endpoint: "https://host.example.com",
      token: "test-token",
      fetch: fetcher,
      storage: { getItem: () => null, setItem: () => undefined },
    });
    const startupRequestCount = requests.length;

    expect(session.bootstrap.settings.language).toBe("zh-CN");
    expect(session.bootstrap.projects.activeProjectId).toBe("host-active");
    expect(await session.settings.load()).toEqual(session.bootstrap.settings);
    expect(requests).toHaveLength(startupRequestCount);
    expect(await session.projects.load()).toEqual(session.bootstrap.projects);
    expect(requests).toHaveLength(startupRequestCount + 1);
    expect(requests).toEqual(
      expect.arrayContaining([
        "https://host.example.com/v1/health",
        "https://host.example.com/v1/host/projects",
        "https://host.example.com/v1/host/settings",
      ]),
    );
    session.dispose();
  });
});
