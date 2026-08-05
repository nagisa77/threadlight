import { readFileSync } from "node:fs";

const importPattern = /@import\s+["']([^"']+)["'];/g;

export function readUiStyles(): string {
  return readStylesheet(new URL("../src/styles.css", import.meta.url));
}

function readStylesheet(url: URL): string {
  const css = readFileSync(url, "utf8");
  return css.replace(importPattern, (_rule, path: string) =>
    readStylesheet(new URL(path, url)),
  );
}
