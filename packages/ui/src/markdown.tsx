import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface MarkdownContentProps {
  children: string;
}

export function MarkdownContent({ children }: MarkdownContentProps) {
  return (
    <div className="markdown-content">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}
