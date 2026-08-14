import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function lines(path: string): number {
  return source(path).split("\n").length;
}

describe("UI feature boundaries", () => {
  it("keeps the application and workspace orchestrators below the agreed limits", () => {
    expect(lines("../src/app.tsx")).toBeLessThan(1_000);
    expect(lines("../src/app-root.tsx")).toBeLessThan(1_000);
    expect(lines("../src/workspace-panel.tsx")).toBeLessThan(1_200);
    expect(lines("../src/i18n.tsx")).toBeLessThan(300);
  });

  it("keeps repository-owned source and test files at or below 1200 lines", () => {
    const repositoryRoot = new URL("../../../", import.meta.url);
    const oversized = ["apps", "packages", "scripts"]
      .flatMap((directory) =>
        repositoryFiles(new URL(`${directory}/`, repositoryRoot)),
      )
      .flatMap((file) => {
        const count = readFileSync(file, "utf8").split("\n").length;
        return count > 1_200 ? [`${file.pathname}: ${count}`] : [];
      });

    expect(oversized).toEqual([]);
  });

  it("keeps state owners and feature modules grouped by domain", () => {
    const controllers = [
      ["task-session", "useTaskSessionController"],
      ["composer", "useComposerController"],
      ["navigation", "useNavigationController"],
      ["delivery", "useDeliveryController"],
    ] as const;
    const app = source("../src/app-root.tsx");

    for (const [feature, controller] of controllers) {
      const controllerSource = source(
        `../src/features/${feature}/controller.ts`,
      );
      expect(controllerSource).toContain(`export function ${controller}`);
      expect(app).toContain(`./features/${feature}/controller.js`);
    }

    expect(
      source("../src/features/composer/voice-input-controller.ts"),
    ).toContain("export function useVoiceInputController");
    expect(source("../src/features/app-shell/app-shell.tsx")).toContain(
      "export function ThreadlightAppShell",
    );
    expect(source("../src/app.tsx")).toContain('export * from "./app-root.js"');
    expect(app).toContain("useNavigationRuntime");
    expect(app).toContain("useTaskSessionRuntime");
    expect(app).toContain("useDeliveryRuntime");

    const flatFeatureFiles = readdirSync(
      new URL("../src/features", import.meta.url),
      { withFileTypes: true },
    )
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    expect(flatFeatureFiles).toEqual([]);
  });

  it("does not replace the app monolith with a controller monolith", () => {
    for (const path of [
      "../src/features/composer/attachment-controller.ts",
      "../src/features/composer/capability-controller.ts",
      "../src/features/delivery/runtime-controller.ts",
      "../src/features/navigation/runtime-controller.ts",
      "../src/features/task-session/computer-controller.ts",
      "../src/features/task-session/runtime-controller.ts",
    ]) {
      expect(lines(path), path).toBeLessThan(1_000);
    }
  });

  it("keeps locale catalogs outside the i18n provider", () => {
    const provider = source("../src/i18n.tsx");
    expect(provider).toContain("./features/i18n/messages/zh-CN.js");
    expect(provider).not.toContain("settingsSubtitle:");

    for (const locale of ["zh-CN", "zh-TW", "en", "ja", "ko"]) {
      expect(
        lines(`../src/features/i18n/messages/${locale}.ts`),
      ).toBeGreaterThan(700);
    }
  });

  it("routes scoped translations through the shared i18n contract", () => {
    for (const path of [
      "../src/automations.tsx",
      "../src/execution-policy.tsx",
      "../src/markdown-source-model.ts",
      "../../../apps/web/src/connection-page.tsx",
    ]) {
      const contents = source(path);
      expect(contents, path).toContain("defineMessageCatalog");
      expect(contents, path).not.toMatch(/const\s+\w+\s*:\s*Record<Language/);
    }
  });

  it("keeps project expansion separate from conversation navigation", () => {
    const sidebar = source("../src/features/navigation/project-sidebar.tsx");
    const toggleExpanded = sidebar.match(
      /function toggleExpanded\(\) \{([\s\S]*?)\n  \}/,
    )?.[1];

    expect(toggleExpanded).toContain("setExpanded(!visibleExpanded)");
    expect(toggleExpanded).not.toContain("onSelect");
    expect(sidebar).toContain("onSelect={() => onSelect(conversation.id)}");
  });

  it("loads feature styles through one stable public entrypoint", () => {
    const entry = source("../src/styles.css");
    expect(entry.match(/@import/g)).toHaveLength(7);
    expect(entry).toContain("./styles/automations.css");
    expect(entry).toContain("./styles/conversation.css");
    expect(entry).toContain("./styles/settings.css");
    expect(entry).toContain("./styles/workspace.css");
    expect(lines("../src/styles.css")).toBeLessThan(20);
  });

  it("keeps markdown link renderers mounted during source preview updates", () => {
    const markdown = source("../src/markdown.tsx");

    expect(markdown).toContain(
      "const MARKDOWN_COMPONENTS: Components = { a: MarkdownAnchor };",
    );
    expect(markdown).toContain("components={MARKDOWN_COMPONENTS}");
    expect(markdown).toContain("<MarkdownLinkContext.Provider");
    expect(markdown).not.toContain("const components: Components = {");
  });

  it("prevents feature slices from importing sibling feature internals", () => {
    const featureRoot = new URL("../src/features/", import.meta.url);
    const violations: string[] = [];

    for (const domain of readdirSync(featureRoot, { withFileTypes: true })) {
      if (!domain.isDirectory()) continue;
      for (const file of featureFiles(
        new URL(`${domain.name}/`, featureRoot),
      )) {
        const contents = readFileSync(file, "utf8");
        for (const match of contents.matchAll(
          /from\s+["']\.\.\/([a-z-]+)\//g,
        )) {
          const target = match[1]!;
          if (target !== domain.name && target !== "shared") {
            violations.push(`${domain.name} -> ${target}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

function featureFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const child = new URL(entry.name, directory);
    if (entry.isDirectory())
      return featureFiles(new URL(`${entry.name}/`, directory));
    return /\.[jt]sx?$/.test(entry.name) ? [child] : [];
  });
}

function repositoryFiles(directory: URL): URL[] {
  const ignoredDirectories = new Set([
    "coverage",
    "dist",
    "node_modules",
    "out",
  ]);
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name)
        ? []
        : repositoryFiles(new URL(`${entry.name}/`, directory));
    }
    return /\.(?:astro|cjs|css|js|jsx|mjs|ts|tsx)$/.test(entry.name)
      ? [new URL(entry.name, directory)]
      : [];
  });
}
