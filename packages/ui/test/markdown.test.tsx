import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  MarkdownContent,
  localFileContextMenuPosition,
  parseLocalFileReference,
  workspaceFileReference,
} from "../src/index.js";

describe("MarkdownContent", () => {
  it("renders headings, emphasis, lists, and fenced code", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent>{`## Architecture

This is **important**.

- Client
- Server

\`\`\`ts
const ready = true;
\`\`\``}</MarkdownContent>,
    );

    expect(html).toContain("<h2>Architecture</h2>");
    expect(html).toContain("<strong>important</strong>");
    expect(html).toContain("<li>Client</li>");
    expect(html).toContain('class="language-ts"');
  });

  it("does not render raw HTML", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent>{`<script>alert("no")</script>`}</MarkdownContent>,
    );

    expect(html).not.toContain("<script>");
  });

  it("marks web links to open outside the app", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent>
        {`[Threadlight](https://example.com/docs)`}
      </MarkdownContent>,
    );

    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
  });

  it("does not mark non-web links as external web pages", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent>{`[Email](mailto:hello@example.com)`}</MarkdownContent>,
    );

    expect(html).toContain('href="mailto:hello@example.com"');
    expect(html).not.toContain('target="_blank"');
  });

  it("renders workspace file references as browser-style file links", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent onOpenLocalFile={() => undefined}>
        {`[i18n.tsx](/Users/tim/Desktop/threadlight/packages/ui/src/i18n.tsx:717)`}
      </MarkdownContent>,
    );

    expect(html).toContain('class="local-file-link"');
    expect(html).toContain("i18n.tsx");
    expect(html).toContain("(line 717)");
    expect(html).toContain('class="lucide ');
    expect(html).not.toContain('target="_blank"');
  });

  it("enables the custom file actions menu when Finder reveal is available", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        onOpenLocalFile={() => undefined}
        onRevealLocalFile={() => undefined}
      >
        {`[report.mp4](/workspace/report.mp4)`}
      </MarkdownContent>,
    );

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
  });

  it("keeps the file actions menu inside the viewport", () => {
    expect(localFileContextMenuPosition(790, 590, 800, 600)).toEqual({
      left: 584,
      top: 470,
      originX: "right",
      originY: "bottom",
    });
    expect(localFileContextMenuPosition(2, 3, 800, 600)).toEqual({
      left: 8,
      top: 8,
      originX: "left",
      originY: "top",
    });
  });

  it("parses local line references and scopes them to the workspace", () => {
    expect(
      parseLocalFileReference(
        "/Users/tim/Desktop/threadlight/packages/ui/src/i18n.tsx:717:9",
      ),
    ).toEqual({
      path: "/Users/tim/Desktop/threadlight/packages/ui/src/i18n.tsx",
      line: 717,
      column: 9,
    });
    expect(
      workspaceFileReference(
        {
          path: "/Users/tim/Desktop/threadlight/packages/ui/src/i18n.tsx",
          line: 717,
        },
        "/Users/tim/Desktop/threadlight",
      ),
    ).toEqual({
      path: "packages/ui/src/i18n.tsx",
      line: 717,
    });
    expect(
      workspaceFileReference(
        { path: "/Users/tim/Desktop/other/secret.txt" },
        "/Users/tim/Desktop/threadlight",
      ),
    ).toBeUndefined();
  });
});
