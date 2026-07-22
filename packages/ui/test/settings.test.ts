import { describe, expect, it } from "vitest";

import { MODEL_OPTIONS, createSettingsUpdate } from "../src/settings.js";

describe("createSettingsUpdate", () => {
  it("offers current frontier and mini model tiers", () => {
    expect(MODEL_OPTIONS.map((option) => option.value)).toEqual([
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.4-mini",
      "gpt-5-mini",
      "gpt-4.1-mini",
    ]);
  });

  it("sends changed keys, explicit removals, and the approval preference", () => {
    expect(
      createSettingsUpdate(
        { value: "  sk-new  ", cleared: false },
        { value: "", cleared: true },
        "gpt-5.6-terra",
        true,
      ),
    ).toEqual({
      openAIApiKey: "sk-new",
      searchApiKey: null,
      model: "gpt-5.6-terra",
      autoApproveAll: true,
    });
  });

  it("does not overwrite unchanged secrets", () => {
    expect(
      createSettingsUpdate(
        { value: "", cleared: false },
        { value: "", cleared: false },
        "gpt-5.6-sol",
        false,
      ),
    ).toEqual({ model: "gpt-5.6-sol", autoApproveAll: false });
  });
});
