import { describe, expect, it } from "vitest";

import { readUiStyles } from "./style-source.js";

const styles = readUiStyles();

describe("source presentation styles", () => {
  it("keeps citation pills quiet until hover or keyboard focus", () => {
    expect(styles).toMatch(
      /\.source-citation-marker\s*\{[^}]*color:\s*var\(--muted\);[^}]*background:\s*color-mix\(in srgb, var\(--ink\) 6%, transparent\);/s,
    );
    expect(styles).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\)[\s\S]*?\.source-citation-marker:hover\s*\{[^}]*color:\s*white;[^}]*background:\s*#11110f;/s,
    );
  });

  it("keeps citation previews anchored and origin-aware on desktop", () => {
    expect(styles).toMatch(
      /\.source-preview\s*\{[^}]*position:\s*fixed;[^}]*transition:[^}]*opacity 150ms var\(--ease-out\),[^}]*transform 150ms var\(--ease-out\);/s,
    );
    expect(styles).toMatch(
      /@starting-style\s*\{\s*\.source-preview\s*\{[^}]*opacity:\s*0;[^}]*transform:\s*scale\(0\.98\);/s,
    );
  });

  it("turns the source collection into a safe-area-aware full page on mobile", () => {
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.source-drawer-backdrop\s*\{[^}]*justify-content:\s*stretch;[^}]*background:\s*var\(--panel\);[\s\S]*?\.source-collection\s*\{[^}]*width:\s*100%;[^}]*height:\s*100dvh;[^}]*border-left:\s*0;[^}]*box-shadow:\s*none;/s,
    );
    expect(styles).toMatch(
      /\.source-collection-header\s*\{[^}]*env\(safe-area-inset-top,[^}]*env\(safe-area-inset-right,[^}]*env\(safe-area-inset-left,/s,
    );
    expect(styles).toMatch(
      /\.source-collection-close,[\s\S]*?\.source-card-locate\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s,
    );
  });

  it("removes spatial motion when reduced motion is requested", () => {
    expect(styles).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.source-preview,\s*\.source-collection\s*\{[^}]*transform:\s*none;[^}]*transition-duration:\s*0ms;/s,
    );
  });
});
