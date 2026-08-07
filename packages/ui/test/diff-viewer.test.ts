import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  isMobileDiffViewport,
  MOBILE_DIFF_QUERY,
  ReviewDiffViewer,
  subscribeToMobileDiffViewport,
} from "../src/diff-viewer.js";

vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useSyncExternalStore: () => true,
  };
});

describe("mobile diff viewport", () => {
  it("uses the mobile breakpoint to remove line-number columns structurally", () => {
    const matchMedia = vi.fn(
      () => ({ matches: true }) as unknown as MediaQueryList,
    );

    expect(isMobileDiffViewport(matchMedia)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(MOBILE_DIFF_QUERY);
  });

  it("omits line-number cells from the mobile diff table", () => {
    const html = renderToStaticMarkup(
      ReviewDiffViewer({
        oldValue: "const value = 1;\n",
        newValue: "const value = 2;\n",
        layout: "unified",
        dark: false,
        language: "typescript",
        styles: {},
      }),
    );

    expect(html).not.toContain("line-number");
    expect(html).toContain(
      '<colgroup><col width="28px"/><col width="auto"/></colgroup>',
    );
  });

  it("updates when the viewport crosses the mobile breakpoint", () => {
    const addEventListener = vi.fn();
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn(
      () =>
        ({
          matches: false,
          addEventListener,
          removeEventListener,
        }) as unknown as MediaQueryList,
    );
    const onStoreChange = vi.fn();

    const unsubscribe = subscribeToMobileDiffViewport(
      onStoreChange,
      matchMedia,
    );

    expect(matchMedia).toHaveBeenCalledWith(MOBILE_DIFF_QUERY);
    expect(addEventListener).toHaveBeenCalledWith("change", onStoreChange);

    unsubscribe();
    expect(removeEventListener).toHaveBeenCalledWith("change", onStoreChange);
  });
});
