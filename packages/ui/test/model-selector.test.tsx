import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ModelSelector } from "../src/model-selector.js";
import {
  isKnownModel,
  modelDescription,
  providerDetails,
} from "../src/model-catalog.js";
import type { Translate } from "../src/i18n.js";

const selectorSource = readFileSync(
  new URL("../src/model-selector.tsx", import.meta.url),
  "utf8",
);

function translate(key: string): string {
  return key;
}

describe("ModelSelector", () => {
  it("renders a compact trigger with an up arrow and no decorative icon", () => {
    const html = renderToStaticMarkup(
      <ModelSelector disabled={false} t={translate as Translate} onSelect={() => undefined} />,
    );

    expect(html).toContain("lucide-chevron-up");
    expect(html).not.toContain("lucide-cpu");
    expect(html).toContain("gpt-5.6-sol");
  });

  it("always anchors its popover strictly above the trigger", () => {
    expect(selectorSource).toContain('pin: "bottom"');
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
