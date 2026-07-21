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
});
