import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  collectBackgroundSiblings,
  dialogTabDestination,
} from "../src/dialog-logic.js";
import { Dialog } from "../src/dialog.js";

describe("Dialog", () => {
  it("renders the shared modal accessibility contract", () => {
    const html = renderToStaticMarkup(
      <Dialog
        className="test-dialog"
        aria-labelledby="test-dialog-title"
        onClose={() => {}}
      >
        <h2 id="test-dialog-title">Test dialog</h2>
        <button type="button">Close</button>
      </Dialog>,
    );

    expect(html).toContain('class="dialog-backdrop"');
    expect(html).toContain('data-dialog-backdrop=""');
    expect(html).toContain('class="test-dialog"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-dialog-panel=""');
  });

  it("wraps Tab only at the focus trap boundaries", () => {
    const first = { id: "first" };
    const middle = { id: "middle" };
    const last = { id: "last" };
    const focusable = [first, middle, last];

    expect(dialogTabDestination(focusable, last, false)).toBe(first);
    expect(dialogTabDestination(focusable, first, true)).toBe(last);
    expect(dialogTabDestination(focusable, middle, false)).toBeUndefined();
    expect(dialogTabDestination(focusable, undefined, false)).toBe(first);
    expect(dialogTabDestination(focusable, undefined, true)).toBe(last);
  });

  it("finds every background branch that must become inert", () => {
    interface TreeNode {
      id: string;
      parent?: TreeNode;
      children: TreeNode[];
    }
    const node = (id: string): TreeNode => ({ id, children: [] });
    const body = node("body");
    const app = node("app");
    const toastRoot = node("toasts");
    const content = node("content");
    const backdrop = node("backdrop");
    body.children.push(app, toastRoot);
    app.parent = body;
    toastRoot.parent = body;
    app.children.push(content, backdrop);
    content.parent = app;
    backdrop.parent = app;

    const background = collectBackgroundSiblings(
      backdrop,
      (candidate) => candidate.parent,
      (candidate) => candidate.children,
      body,
    );

    expect(background.map(({ id }) => id)).toEqual(["content", "toasts"]);
  });

  it("is the only implementation of aria-modal across product modals", () => {
    const modalFiles = [
      "../src/automations.tsx",
      "../src/capabilities.tsx",
      "../src/command-palette.tsx",
      "../src/diagnostics.tsx",
      "../src/execution-policy.tsx",
      "../src/markdown.tsx",
      "../src/workspace-panel.tsx",
      "../src/features/delivery/delivery-center.tsx",
      "../src/features/delivery/review-view.tsx",
      "../src/features/navigation/project-dialogs.tsx",
      "../src/features/navigation/project-sidebar.tsx",
    ];
    const modalSources = modalFiles.map((path) =>
      readFileSync(new URL(path, import.meta.url), "utf8"),
    );
    const dialogSource = readFileSync(
      new URL("../src/dialog.tsx", import.meta.url),
      "utf8",
    );
    const popoverSource = readFileSync(
      new URL("../src/popover.tsx", import.meta.url),
      "utf8",
    );

    expect(modalSources.join("\n")).not.toContain("aria-modal=");
    expect(
      modalSources.reduce(
        (count, source) => count + (source.match(/<Dialog\b/g)?.length ?? 0),
        0,
      ),
    ).toBe(15);
    expect(dialogSource).toContain('event.key === "Escape"');
    expect(dialogSource).toContain("element.inert = true");
    expect(dialogSource).toContain("restoreDialogFocus(controller)");
    expect(dialogSource).toContain("eventTargetIsDialogPortal");
    expect(popoverSource).toContain('data-dialog-portal=""');
  });
});
