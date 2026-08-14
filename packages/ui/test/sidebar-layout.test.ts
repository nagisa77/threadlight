import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sidebarStartsOpen } from "../src/app.js";
import { readUiStyles } from "./style-source.js";

const styles = readUiStyles();
const appSource = readFileSync(
  new URL("../src/app.tsx", import.meta.url),
  "utf8",
);
const desktopRenderer = readFileSync(
  new URL("../../../apps/desktop/src/renderer/main.tsx", import.meta.url),
  "utf8",
);
const desktopPreload = readFileSync(
  new URL("../../../apps/desktop/src/preload/index.ts", import.meta.url),
  "utf8",
);

describe("sidebar visibility", () => {
  it("starts closed on phones and restores the desktop preference", () => {
    expect(sidebarStartsOpen(true, null)).toBe(false);
    expect(sidebarStartsOpen(false, null)).toBe(true);
    expect(sidebarStartsOpen(false, "false")).toBe(false);
    expect(sidebarStartsOpen(false, "true")).toBe(true);
  });

  it("collapses the desktop column without shrinking the workspace", () => {
    expect(styles).toMatch(
      /\.app-shell\.sidebar-hidden\s*\{[^}]*grid-template-columns:\s*0 minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /\.app-shell\.sidebar-hidden \.sidebar\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s,
    );
  });

  it("keeps the macOS reveal control clear of the window controls", () => {
    expect(desktopRenderer).toContain(
      'document.documentElement.dataset.platform = "desktop"',
    );
    expect(desktopRenderer).toContain(
      'document.documentElement.dataset.os = "macos"',
    );
    expect(desktopRenderer).toContain("if (window.threadlightDesktop.isMacOS)");
    expect(desktopPreload).toContain('isMacOS: process.platform === "darwin"');
    expect(styles).toMatch(
      /html\[data-platform="desktop"\]\[data-os="macos"\][\s\S]*?\.app-shell\.sidebar-hidden[\s\S]*?\.sidebar-reveal-button\s*\{[^}]*left:\s*74px;/s,
    );
    expect(styles).toMatch(
      /html\[data-platform="desktop"\]\[data-os="macos"\][\s\S]*?\.app-shell\.sidebar-hidden[\s\S]*?\.workspace-header\s*\{[^}]*padding-left:\s*116px;/s,
    );
    expect(styles).toMatch(
      /html\[data-platform="desktop"\]\[data-os="macos"\][\s\S]*?\.app-shell\.sidebar-hidden[\s\S]*?\.workspace-header-drag-region\s*\{[^}]*left:\s*116px;/s,
    );
  });

  it("keeps sidebar controls outside the draggable titlebar region", () => {
    expect(styles).toMatch(
      /\.workspace-header\s*\{[^}]*-webkit-app-region:\s*drag;/s,
    );
    expect(styles).toMatch(
      /\.workspace-header-drag-region\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*-webkit-app-region:\s*drag;/s,
    );
    expect(styles).toMatch(
      /\.workspace-header-actions\s*\{[^}]*-webkit-app-region:\s*no-drag;/s,
    );
    expect(styles).toMatch(
      /\.workspace-header\s+:is\(button, a, input, textarea, select, summary, \[role="button"\]\)\s*\{[^}]*-webkit-app-region:\s*no-drag;/s,
    );
    expect(styles).toMatch(
      /\.app-shell\.sidebar-hidden \.workspace-header-drag-region\s*\{[^}]*left:\s*54px;/s,
    );
  });

  it("uses an overlaid drawer and compact content spacing on phones", () => {
    expect(styles).toMatch(
      /\.workspace-primary\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.sidebar\s*\{[^}]*position:\s*absolute;[^}]*width:\s*min\(86vw, 320px\);[^}]*transform:\s*translateX\(-100%\);/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.app-shell\.sidebar-open \.sidebar\s*\{[^}]*visibility:\s*visible;[^}]*transform:\s*translateX\(0\);/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.composer-wrap\s*\{[^}]*padding:\s*8px 10px max\(10px, env\(safe-area-inset-bottom, 0px\)\);/s,
    );
  });

  it("closes the phone drawer before opening destructive confirmations", () => {
    expect(appSource).toMatch(
      /onDeleteProject=\{\(project\) => \{\s*closeSidebarForNavigation\(\);[\s\S]*?setPendingDeleteProject\(project\);/s,
    );
    expect(appSource).toMatch(
      /onDeleteConversation=\{\(projectId, conversation\) => \{\s*closeSidebarForNavigation\(\);[\s\S]*?setPendingDelete\(\{ projectId, conversation \}\);/s,
    );
  });
});
