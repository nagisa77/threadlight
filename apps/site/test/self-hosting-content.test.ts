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
    expect(pageSource).toContain(
      "curl -fsSL https://threadlight.xyz/install.sh | sh -s -- install --host-only --origin https://nagisa77.github.io",
    );
    expect(pageSource).toContain('href="#host-only"');
    expect(pageSource).toContain('id="host-only"');
    expect(pageSource).toContain("Host-only install");
    expect(pageSource).toContain("仅 Host 一行安装");
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
    expect(styles).toMatch(
      /@media \(max-width: 760px\)[\s\S]*\.host-only-card\s*\{[\s\S]*grid-template-columns:\s*1fr/,
    );
  });

  it("announces copied commands accessibly without changing the copy controls", () => {
    expect(pageSource).toContain('copySuccess: "Command copied"');
    expect(pageSource).toContain('copySuccess: "命令已复制"');
    expect(pageSource.match(/role="status" aria-atomic="true" data-copy-status/g)).toHaveLength(2);
    expect(pageSource.match(/data-copy-success=\{copy\.hero\.selfHost\.copySuccess\}/g)).toHaveLength(2);
    expect(pageSource).toContain(
      'querySelector<HTMLElement>("[data-copy-status]")',
    );
    expect(pageSource).toContain(
      'status.textContent = status.dataset.copySuccess ?? ""',
    );
    expect(pageSource).not.toContain("copyButton.textContent =");
    expect(pageSource).toContain("navigator.clipboard.writeText(value)");
    expect(pageSource).toContain('document.execCommand("copy")');
    expect(styles).toMatch(/\.sr-only\s*\{[\s\S]*position:\s*absolute[\s\S]*clip:\s*rect\(0, 0, 0, 0\)/);
  });
});
