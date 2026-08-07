import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ModelSelector,
  configuredModelForProvider,
  isCurrentModelSelection,
} from "../src/model-selector.js";
import {
  isKnownModel,
  modelDescription,
  providerDetails,
} from "../src/model-catalog.js";
import type { Translate } from "../src/i18n.js";

const selectorSource = readFileSync(
  new URL("../src/features/composer/model-selector.tsx", import.meta.url),
  "utf8",
);

function translate(key: string): string {
  return key;
}

describe("ModelSelector", () => {
  it("provides a responsive brain icon alongside the full model label", () => {
    const html = renderToStaticMarkup(
      <ModelSelector disabled={false} t={translate as Translate} onSelect={() => undefined} />,
    );

    expect(html).toContain("lucide-chevron-up");
    expect(html).toContain("lucide-brain");
    expect(html).toContain("gpt-5.6-sol");
  });

  it("marks a model selected only when both provider and model match", () => {
    expect(
      isCurrentModelSelection("openai", "gpt-5.6-sol", "openai", "gpt-5.6-sol"),
    ).toBe(true);
    expect(
      isCurrentModelSelection("openai", "gpt-5.6-sol", "deepseek", "gpt-5.6-sol"),
    ).toBe(false);
  });

  it("shows the saved custom model even when another provider is active", () => {
    expect(
      configuredModelForProvider("custom", {
        customModel: "local/vision-model",
      } as Parameters<typeof configuredModelForProvider>[1], "gpt-5.6-sol"),
    ).toBe("local/vision-model");
    expect(
      configuredModelForProvider("custom", undefined, "gpt-5.6-sol"),
    ).toBe("llama3.2");
    expect(selectorSource).toContain('level.provider === "custom"');
  });

  it("always anchors its popover strictly above the trigger", () => {
    expect(selectorSource).toContain('pin: "bottom"');
    expect(selectorSource).toContain("ActionPopoverHeading");
  });

  it("shows provider rows as submenu entries with a trailing chevron", () => {
    expect(selectorSource).toContain("ChevronRight");
    expect(selectorSource).toContain("aria-haspopup=\"menu\"");
  });

  it("drops the decorative per-provider color dots", () => {
    expect(selectorSource).not.toContain("PROVIDER_DOTS");
    expect(selectorSource).not.toContain("model-provider-dot");
  });
});

describe("model catalog", () => {
  it("keeps no built-in option for the custom provider", () => {
    expect(providerDetails("custom").models).toEqual([]);
    expect(isKnownModel("custom", "llama3.2")).toBe(false);
  });

  it("describes the custom provider model by its settings hint", () => {
    expect(
      modelDescription("custom", "llama3.2", translate as Translate),
    ).toBe("customModelDescription");
  });
});
