import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  connectionPageCopy,
  RemoteConnectionPage,
} from "../src/connection-page.js";

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
