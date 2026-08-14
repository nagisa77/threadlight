import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  fileReaderReference,
  MarkdownContent,
  localFileContextMenuPosition,
  parseLocalFileReference,
  sourceDisplayName,
  sourceFaviconUrl,
  sourcePresentationKind,
  sourcesForCitation,
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

  it("renders inline citation markers and a message source trigger", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        sources={[
          {
            id: "s1",
            title: "Threadlight",
            url: "https://example.com/threadlight",
            domain: "example.com",
          },
        ]}
        citations={[
          {
            id: "citation-1",
            sourceIds: ["s1"],
            excerpt: "Threadlight is an agent runtime.",
          },
        ]}
      >
        {"Threadlight is an agent runtime.[1](threadlight-source:citation-1)"}
      </MarkdownContent>,
    );

    expect(html).toContain('class="source-citation-marker pressable"');
    expect(html).toContain("查看引用 1");
    expect(html).toContain("Example");
    expect(html).toContain("1 个来源");
    expect(html).not.toContain('class="source-citation-more"');
    expect(html).not.toContain('href="threadlight-source:');
  });

  it("renders a compact brand and overflow count for multi-source citations", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent
        sources={[
          {
            id: "s1",
            title: "Threadlight repository",
            url: "https://github.com/nagisa77/threadlight",
            domain: "github.com",
          },
          {
            id: "s2",
            title: "Threadlight docs",
            url: "https://threadlight.xyz/docs",
            domain: "threadlight.xyz",
          },
        ]}
        citations={[
          {
            id: "citation-1",
            sourceIds: ["s1", "s2"],
            excerpt: "Threadlight has a provider-neutral agent loop.",
          },
        ]}
      >
        {
          "Threadlight has a provider-neutral agent loop.[1](threadlight-source:citation-1)"
        }
      </MarkdownContent>,
    );

    expect(html).toContain("GitHub");
    expect(html).toContain('class="source-citation-more"');
    expect(html).toContain("+1");
    expect(html).not.toContain(">1</button>");
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

  it("routes files outside the project to the system reader", () => {
    expect(
      fileReaderReference(
        { path: "/Users/tim/Desktop/other/report.pdf", line: 4 },
        "/Users/tim/Desktop/threadlight",
      ),
    ).toEqual({
      source: "system",
      path: "/Users/tim/Desktop/other/report.pdf",
      line: 4,
    });
    expect(
      fileReaderReference(
        { path: "../shared/config.json" },
        "/Users/tim/Desktop/threadlight",
      ),
    ).toEqual({
      source: "system",
      path: "/Users/tim/Desktop/shared/config.json",
    });
    expect(
      fileReaderReference(
        { path: "./packages/ui/src/index.ts" },
        "/Users/tim/Desktop/threadlight",
      ),
    ).toEqual({
      source: "workspace",
      path: "packages/ui/src/index.ts",
    });
  });
});

describe("source presentation", () => {
  const sources = [
    {
      id: "s1",
      title: "GitHub",
      url: "https://github.com/nagisa77/threadlight",
      domain: "github.com",
    },
    {
      id: "s2",
      title: "Docs",
      url: "https://docs.example.com/threadlight",
      domain: "docs.example.com",
    },
  ] as const;

  it("uses anchored previews on desktop and a collection page on mobile", () => {
    expect(sourcePresentationKind("citation-1", 1280)).toBe("preview");
    expect(sourcePresentationKind("citation-1", 720)).toBe("collection");
    expect(sourcePresentationKind(undefined, 1280)).toBe("collection");
  });

  it("preserves citation source order and ignores missing source ids", () => {
    expect(
      sourcesForCitation(
        {
          id: "citation-1",
          sourceIds: ["s2", "missing", "s1"],
          excerpt: "Supported statement",
        },
        sources,
      ).map((source) => source.id),
    ).toEqual(["s2", "s1"]);
  });

  it("formats recognizable brands and safe favicon URLs", () => {
    expect(sourceDisplayName(sources[0])).toBe("GitHub");
    expect(sourceDisplayName(sources[1])).toBe("Docs");
    expect(sourceFaviconUrl(sources[1].url)).toBe(
      "https://docs.example.com/favicon.ico",
    );
    expect(sourceFaviconUrl("javascript:alert(1)")).toBeUndefined();
  });
});
