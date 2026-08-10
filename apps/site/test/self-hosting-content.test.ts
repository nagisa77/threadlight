import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  new URL("../src/components/HomePage.astro", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../src/styles/site.css", import.meta.url),
  "utf8",
);

describe("homepage launch choices", () => {
  it("offers desktop, hosted Web, and recommended one-line self-hosting", () => {
    expect(pageSource).toContain("Download the desktop app");
    expect(pageSource).toContain("下载桌面端");
    expect(pageSource).toContain("Open Web client");
    expect(pageSource).toContain("打开 Web 客户端");
    expect(pageSource).toContain("Deploy Host + Web");
    expect(pageSource).toContain("一键部署 Host + Web");
    expect(pageSource).toContain(
      "curl -fsSL https://threadlight.xyz/install.sh | sh",
    );
    expect(pageSource).not.toContain("--project");
    expect(pageSource).toContain("HTTPS domain");
    expect(pageSource).toContain("HTTPS 域名");
    expect(pageSource).toContain("docs/SELF_HOSTING.md");
    expect(pageSource).toContain("docs/SELF_HOSTING.zh-CN.md");
  });

  it("supports code copy and a responsive three-choice layout", () => {
    expect(pageSource).toContain(
      'document.querySelectorAll<HTMLButtonElement>("[data-copy]")',
    );
    expect(styles).toMatch(/@media \(max-width: 1080px\)[\s\S]*\.launch-grid/);
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.launch-card-recommended/,
    );
  });
});
