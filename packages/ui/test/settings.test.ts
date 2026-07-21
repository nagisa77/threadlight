import { describe, expect, it } from "vitest";

import { createSettingsUpdate } from "../src/settings.js";

describe("createSettingsUpdate", () => {
  it("sends changed keys, explicit removals, and the approval preference", () => {
    expect(
      createSettingsUpdate(
        { value: "  sk-new  ", cleared: false },
        { value: "", cleared: true },
        true,
      ),
    ).toEqual({
      openAIApiKey: "sk-new",
      searchApiKey: null,
      autoApproveAll: true,
    });
  });

  it("does not overwrite unchanged secrets", () => {
    expect(
      createSettingsUpdate(
        { value: "", cleared: false },
        { value: "", cleared: false },
        false,
      ),
    ).toEqual({ autoApproveAll: false });
  });
});
