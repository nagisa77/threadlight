import { describe, expect, it } from "vitest";
import { readUiStyles } from "./style-source.js";

const styles = readUiStyles();

describe("project row activity layout", () => {
  it("gives project activity the trailing edge until row actions are revealed", () => {
    expect(styles).toMatch(
      /\.project-row-actions \{[\s\S]*?width: 0;[\s\S]*?overflow: hidden;[\s\S]*?opacity: 0;[\s\S]*?\}/,
    );
    expect(styles).toMatch(
      /\.project-row-actions:focus-within,[\s\S]*?\.project-row-actions\.open \{[\s\S]*?width: 56px;[\s\S]*?padding-right: 3px;[\s\S]*?opacity: 1;[\s\S]*?\}/,
    );
    expect(styles).toMatch(
      /\.project-group:hover \.project-row-actions \{[\s\S]*?width: 56px;[\s\S]*?padding-right: 3px;[\s\S]*?opacity: 1;[\s\S]*?\}/,
    );
  });

  it("keeps task activity at the trailing edge when no task actions exist", () => {
    expect(styles).toMatch(
      /\.thread-item-select \{[\s\S]*?padding: 4px 8px;[\s\S]*?\}/,
    );
    expect(styles).toMatch(
      /\.thread-item:has\(> \.thread-actions\) > \.thread-item-select \{[\s\S]*?padding-right: 30px;[\s\S]*?\}/,
    );
  });

  it("raises only the open task action group above the other ellipsis buttons", () => {
    expect(styles).toMatch(/\.thread-actions\s*\{[^}]*z-index:\s*4;/s);
    expect(styles).toMatch(/\.thread-actions\.open\s*\{[^}]*z-index:\s*5;/s);
  });

  it("keeps portaled project menus above the mobile sidebar", () => {
    expect(styles).toMatch(/\.action-popover\s*\{[^}]*z-index:\s*90;/s);
    expect(styles).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.sidebar\s*\{[^}]*z-index:\s*80;/s,
    );
  });
});
