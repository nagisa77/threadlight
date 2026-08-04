import { refractor } from "refractor";
import tsx from "refractor/tsx";

import { languageForPath } from "./source-language.js";

refractor.register(tsx);

export interface HighlightSegment {
  text: string;
  className?: string;
}

interface HighlightNode {
  type: string;
  value?: string;
  properties?: {
    className?: string | readonly string[];
  };
  children?: readonly HighlightNode[];
}

export function highlightedFileLines(
  name: string,
  content: string,
): HighlightSegment[][] {
  const language = languageForPath(name);
  if (!language || !refractor.registered(language)) {
    return plainFileLines(content);
  }

  try {
    const root = refractor.highlight(content, language) as HighlightNode;
    const lines: HighlightSegment[][] = [[]];

    const appendText = (text: string, classNames: readonly string[]) => {
      const parts = text.split("\n");
      parts.forEach((part, index) => {
        if (part) {
          lines[lines.length - 1].push({
            text: part,
            ...(classNames.length > 0
              ? { className: [...new Set(classNames)].join(" ") }
              : {}),
          });
        }
        if (index < parts.length - 1) lines.push([]);
      });
    };

    const visit = (
      node: HighlightNode,
      inheritedClassNames: readonly string[],
    ) => {
      if (node.type === "text") {
        appendText(node.value ?? "", inheritedClassNames);
        return;
      }
      const ownClassName = node.properties?.className;
      const ownClassNames = Array.isArray(ownClassName)
        ? ownClassName.filter(
            (className): className is string => typeof className === "string",
          )
        : typeof ownClassName === "string"
          ? ownClassName.split(/\s+/).filter(Boolean)
          : [];
      const classNames = [...inheritedClassNames, ...ownClassNames];
      for (const child of node.children ?? []) visit(child, classNames);
    };

    visit(root, []);
    return lines;
  } catch {
    return plainFileLines(content);
  }
}

function plainFileLines(content: string): HighlightSegment[][] {
  return content.split("\n").map((text) => text ? [{ text }] : []);
}
