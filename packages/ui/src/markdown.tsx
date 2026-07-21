import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownContentProps {
  children: string;
}

const components: Components = {
  a({ href, node: _node, ...props }) {
    if (!isWebUrl(href)) return <a href={href} {...props} />;

    return (
      <a
        href={href}
        {...props}
        target="_blank"
        rel="noreferrer noopener"
      />
    );
  },
};

export function MarkdownContent({ children }: MarkdownContentProps) {
  return (
    <div className="markdown-content">
      <Markdown components={components} remarkPlugins={[remarkGfm]}>
        {children}
      </Markdown>
    </div>
  );
}

function isWebUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
