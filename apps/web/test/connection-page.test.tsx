import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  connectionPageCopy,
  RemoteConnectionPage,
} from "../src/connection-page.js";
import type { SavedHost } from "../src/saved-hosts.js";

const savedHosts: SavedHost[] = [
  {
    id: "a",
    name: "办公室",
    endpoint: "https://host-a.example.com",
    token: "tk-a",
    lastConnectedAt: 2,
  },
  {
    id: "b",
    name: "",
    endpoint: "https://host-b.example.com",
    token: "tk-b",
    lastConnectedAt: 1,
  },
];

describe("remote connection page preferences", () => {
  it("starts independently in English with the system theme", () => {
    const html = renderToStaticMarkup(
      <RemoteConnectionPage
        initialEndpoint=""
        initialToken=""
        autoConnect={false}
        onConnect={async () => {}}
      />,
    );

    expect(html).toContain("Connect to a remote Host");
    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('<option value="en" selected="">English</option>');
    expect(html).toContain('<option value="system" selected="">System</option>');
    expect(html).not.toContain("连接远端 Host");
  });

  it("provides complete connection copy for every interface language", () => {
    const titles = [
      connectionPageCopy("en").title,
      connectionPageCopy("zh-CN").title,
      connectionPageCopy("zh-TW").title,
      connectionPageCopy("ja").title,
      connectionPageCopy("ko").title,
    ];

    expect(titles).toEqual([
      "Connect to a remote Host",
      "连接远端 Host",
      "連線遠端 Host",
      "リモート Host に接続",
      "원격 Host에 연결",
    ]);
  });
});

describe("saved host selection", () => {
  it("lists saved hosts in the selector and prefills the matching one", () => {
    const html = renderToStaticMarkup(
      <RemoteConnectionPage
        initialEndpoint="https://host-a.example.com"
        initialToken="tk-a"
        autoConnect={false}
        onConnect={async () => {}}
        initialHosts={savedHosts}
      />,
    );

    expect(html).toContain('aria-label="Saved hosts"');
    expect(html).toContain("<option value=\"\">Add a new host…</option>");
    expect(html).toContain(">办公室</option>");
    expect(html).toContain(">https://host-b.example.com</option>");
    expect(html).toContain('value="https://host-a.example.com"');
    expect(html).toContain('value="tk-a"');
    expect(html).toContain('aria-label="Manage saved hosts"');
  });

  it("renders the selector without saved hosts by default", () => {
    const html = renderToStaticMarkup(
      <RemoteConnectionPage
        initialEndpoint=""
        initialToken=""
        autoConnect={false}
        onConnect={async () => {}}
      />,
    );
    expect(html).toContain('aria-label="Saved hosts"');
    expect(html).not.toContain(">办公室</option>");
  });

  it("has complete new copy fields for every interface language", () => {
    const languages = ["en", "zh-CN", "zh-TW", "ja", "ko"] as const;
    const fields = [
      "savedHosts",
      "savedHostsPlaceholder",
      "manageHosts",
      "hostName",
      "saveHost",
      "cancel",
      "deleteHost",
      "deleteHostConfirm",
      "editHost",
      "emptyHosts",
    ] as const;

    for (const language of languages) {
      const copy = connectionPageCopy(language);
      for (const field of fields) {
        expect(copy[field].length, `${language}.${field}`).toBeGreaterThan(0);
      }
    }
  });

  it("updates the token notice to reflect browser persistence", () => {
    for (const language of ["en", "zh-CN", "zh-TW", "ja", "ko"] as const) {
      const notice = connectionPageCopy(language).tokenNotice;
      expect(notice.length).toBeGreaterThan(0);
      expect(notice).not.toMatch(/tab session|タブセッション|标签会话/i);
    }
  });
});
