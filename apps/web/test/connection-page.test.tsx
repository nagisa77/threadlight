import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  connectionPageCopy,
  RemoteConnectionPage,
} from "../src/connection-page.js";
import type { HostRecord } from "../src/host-store.js";

function host(partial: Partial<HostRecord>): HostRecord {
  return {
    id: "host-a",
    name: "Prod",
    endpoint: "https://prod.example.com",
    token: "token-a",
    lastConnectedAt: 2,
    ...partial,
  };
}

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
    expect(html).toContain("Connect a new Host");
    expect(html).toContain("WEB CLIENT");
    expect(html).toContain('aria-label="Language"');
    expect(html).toContain('<option value="en" selected="">English</option>');
    expect(html).toContain(
      '<option value="system" selected="">System</option>',
    );
    expect(html).not.toContain("连接远端 Host");
    expect(html).not.toContain("Saved hosts");
  });

  it("renders the endpoint as a forgiving text input instead of native URL validation", () => {
    const html = renderToStaticMarkup(
      <RemoteConnectionPage
        initialEndpoint=""
        initialToken=""
        autoConnect={false}
        onConnect={async () => {}}
      />,
    );

    expect(html).not.toContain('type="url"');
    expect(html).toContain('inputMode="url"');
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

    for (const language of ["en", "zh-CN", "zh-TW", "ja", "ko"] as const) {
      const copy = connectionPageCopy(language);
      expect(copy.savedHosts.length).toBeGreaterThan(0);
      expect(copy.newHost.length).toBeGreaterThan(0);
      expect(copy.editHost.length).toBeGreaterThan(0);
      expect(copy.saveChanges.length).toBeGreaterThan(0);
      expect(copy.reconnect.length).toBeGreaterThan(0);
      expect(copy.delete.length).toBeGreaterThan(0);
      expect(copy.deleteConfirm.length).toBeGreaterThan(0);
      expect(copy.eyebrow.length).toBeGreaterThan(0);
      expect(copy.saved.length).toBeGreaterThan(0);
      expect(copy.endpointSchemeError.length).toBeGreaterThan(0);
      expect(copy.endpointFormatError.length).toBeGreaterThan(0);
    }
  });
});

describe("remote connection page saved hosts", () => {
  const hosts = [
    host({
      id: "a",
      name: "Prod",
      endpoint: "https://prod.example.com",
      token: "token-a",
      lastConnectedAt: 2,
    }),
    host({
      id: "b",
      name: "Dev",
      endpoint: "https://dev.example.com",
      token: "token-b",
      lastConnectedAt: 1,
    }),
  ];

  it("renders every saved host with its name and endpoint", () => {
    const html = renderToStaticMarkup(
      <RemoteConnectionPage
        initialEndpoint=""
        initialToken=""
        autoConnect={false}
        savedHosts={hosts}
        onConnect={async () => {}}
      />,
    );

    expect(html).toContain("Saved hosts");
    expect(html).toContain("Prod");
    expect(html).toContain("https://prod.example.com");
    expect(html).toContain("Dev");
    expect(html).toContain("https://dev.example.com");
    // Host rows keep the two useful actions: select for editing and reconnect.
    expect(html.match(/>Reconnect<\/span>/g)).toHaveLength(2);
    expect(html).not.toContain("web-host-actions");
    expect(html).not.toContain('aria-label="Edit"');
    // Destructive editing is centralized in the selected Host form.
    expect(html.match(/aria-label="Delete"/g)).toHaveLength(1);
  });

  it("separates context from connection controls without staged row animation", () => {
    const html = renderToStaticMarkup(
      <RemoteConnectionPage
        initialEndpoint=""
        initialToken=""
        autoConnect={false}
        savedHosts={hosts}
        onConnect={async () => {}}
      />,
    );

    expect(html).toContain('<aside class="web-connect-intro">');
    expect(html).toContain('<div class="web-connect-content">');
    expect(html).not.toContain("--host-index");
  });

  it("preselects the saved host matching the initial endpoint for editing", () => {
    const html = renderToStaticMarkup(
      <RemoteConnectionPage
        initialEndpoint="https://dev.example.com"
        initialToken="token-b"
        autoConnect={false}
        savedHosts={hosts}
        onConnect={async () => {}}
      />,
    );

    expect(html).toContain("Edit saved Host");
    expect(html).not.toContain("Connect a new Host");
    // The dev endpoint is prefilled into the form.
    expect(html).toContain('value="https://dev.example.com"');
    expect(html).toContain("Save changes");
  });

  it("preselects the most recent host when no endpoint is given", () => {
    const html = renderToStaticMarkup(
      <RemoteConnectionPage
        initialEndpoint=""
        initialToken=""
        autoConnect={false}
        savedHosts={hosts}
        onConnect={async () => {}}
      />,
    );

    expect(html).toContain("Edit saved Host");
    expect(html).toContain('value="https://prod.example.com"');
  });
});

describe("remote connection page responsive layout", () => {
  const styles = readFileSync(
    new URL("../src/web.css", import.meta.url),
    "utf8",
  );

  it("uses a two-column card on wide screens and a single column on mobile", () => {
    expect(styles).toMatch(
      /\.web-connect-card\s*{[^}]*grid-template-columns:\s*minmax\(230px, 0\.78fr\) minmax\(0, 1\.42fr\)/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.web-connect-card\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
  });

  it("stacks form fields and preserves touch-sized controls on mobile", () => {
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.web-connect-fields\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.web-connect-form input\s*{[^}]*height:\s*44px/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 700px\)[\s\S]*?\.web-connect-submit\s*{[^}]*min-height:\s*44px/,
    );
  });
});
