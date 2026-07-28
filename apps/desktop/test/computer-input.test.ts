import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  enableChildWindowCaptureWithAddon,
  nativeComputerInputCandidates,
  performComputerActionsWithAddon,
  requestScreenCaptureAccessWithAddon,
} from "../src/main/computer-input.js";

describe("native macOS computer input bridge", () => {
  it("enables child-window capture through the native bridge", () => {
    const enableChildWindowCapture = vi.fn(() => true);

    expect(
      enableChildWindowCaptureWithAddon({
        perform: vi.fn(),
        enableChildWindowCapture,
      }),
    ).toBe(true);
    expect(enableChildWindowCapture).toHaveBeenCalledOnce();
    expect(
      enableChildWindowCaptureWithAddon({ perform: vi.fn() }),
    ).toBe(false);
  });

  it("requests screen capture access through the native bridge", () => {
    const requestScreenCaptureAccess = vi.fn(() => true);

    expect(
      requestScreenCaptureAccessWithAddon({
        perform: vi.fn(),
        requestScreenCaptureAccess,
      }),
    ).toBe(true);
    expect(requestScreenCaptureAccess).toHaveBeenCalledOnce();
    expect(
      requestScreenCaptureAccessWithAddon({ perform: vi.fn() }),
    ).toBe(false);
  });

  it("retains an aliased active element before releasing the old reference", () => {
    const source = readFileSync(
      new URL("../native/computer-input.mm", import.meta.url),
      "utf8",
    );
    const setActive =
      /void SetActive\(AXUIElementRef element,[\s\S]*?\) \{([\s\S]*?)\n  \}/.exec(
        source,
      )?.[1];

    expect(setActive).toBeDefined();
    expect(setActive?.indexOf("CFRetain(element)")).toBeGreaterThan(-1);
    expect(setActive?.indexOf("CFRetain(element)")).toBeLessThan(
      setActive?.indexOf("CFRelease(active_)") ?? -1,
    );
  });

  it("preserves the active AX element across native action batches", () => {
    const source = readFileSync(
      new URL("../native/computer-input.mm", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Driver &SharedDriver(bool isVirtual)");
    expect(source).toContain(
      "SharedDriver(isVirtual).Run(Array(request, @\"actions\"))",
    );
    expect(source).toContain("AXUIElementRef active = ActiveFor(processId)");
    expect(source).toContain(
      "setText(active, activeSelectedTextError, activeValueError)",
    );
  });

  it("falls back to PID-scoped Unicode input for custom non-AX text fields", () => {
    const source = readFileSync(
      new URL("../native/computer-input.mm", import.meta.url),
      "utf8",
    );
    const fallback = source.indexOf("PostUnicodeText(text, true, processId)");
    const virtualFailure = source.indexOf(
      "The target application has no editable focused AX element",
    );

    expect(fallback).toBeGreaterThan(-1);
    expect(virtualFailure).toBeGreaterThan(-1);
    expect(fallback).toBeLessThan(virtualFailure);
  });

  it("keeps virtual AX input in the background without changing app or AX focus", () => {
    const source = readFileSync(
      new URL("../native/computer-input.mm", import.meta.url),
      "utf8",
    );
    const click = /void Click\(NSDictionary \*action, int count\) \{([\s\S]*?)\n  \}/.exec(
      source,
    )?.[1];
    const type = /void Type\(NSDictionary \*action\) \{([\s\S]*?)\n  \}/.exec(
      source,
    )?.[1];
    const drag = /void Drag\(NSDictionary \*action\) \{([\s\S]*?)\n  \}/.exec(
      source,
    )?.[1];
    const keypress =
      /void Keypress\(NSDictionary \*action\) \{([\s\S]*?)\n  \}/.exec(
        source,
      )?.[1];

    expect(click).not.toContain("ActivateSystemTarget");
    expect(drag).not.toContain("kAXFocusedAttribute");
    expect(keypress).toContain("if (!isVirtual_)");
    expect(keypress).toContain("ActivateSystemTarget(processId)");
    expect(type).not.toContain("if (isVirtual_)\n      ActivateSystemTarget");
    expect(source).not.toContain("FocusNearest");
    expect(source).not.toContain("kAXFocusedAttribute");
  });

  it("passes routed actions to the native AX module without changing shape", () => {
    const perform = vi.fn();
    performComputerActionsWithAddon(
      { perform },
      [
        {
          type: "click",
          x: 220,
          y: 120,
          button: "left",
          processId: 42,
        },
        {
          type: "type",
          text: "亮度",
          processId: 42,
        },
        {
          type: "drag",
          path: [
            { x: 300, y: 400 },
            { x: 500, y: 400 },
          ],
          processId: 42,
        },
      ],
      "virtual",
    );

    expect(JSON.parse(perform.mock.calls[0]?.[0] as string)).toEqual({
      actions: [
        {
          type: "click",
          x: 220,
          y: 120,
          button: "left",
          processId: 42,
        },
        {
          type: "type",
          text: "亮度",
          processId: 42,
        },
        {
          type: "drag",
          path: [
            { x: 300, y: 400 },
            { x: 500, y: 400 },
          ],
          processId: 42,
        },
      ],
      inputMode: "virtual",
    });
  });

  it("resolves both bundled and source-tree native module locations", () => {
    expect(nativeComputerInputCandidates("/app/out/main")).toContain(
      "/app/out/native/computer-input.node",
    );
    expect(nativeComputerInputCandidates("/app/src/main")).toContain(
      "/app/out/native/computer-input.node",
    );
  });
});
