import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MarkdownContent } from "../src/index.js";

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
});
