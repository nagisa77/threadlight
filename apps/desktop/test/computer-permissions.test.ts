import { describe, expect, it, vi } from "vitest";

import {
  ComputerPermissionRequiredError,
  ComputerPermissionService,
  type ComputerPermissionPlatform,
} from "../src/main/computer-permissions.js";

function platform(
  overrides: Partial<ComputerPermissionPlatform> = {},
): ComputerPermissionPlatform {
  return {
    screenRecordingStatus: () => "granted",
    accessibilityTrusted: () => true,
    requestScreenRecording: () => true,
    openSettings: async () => undefined,
    ...overrides,
  };
}

describe("ComputerPermissionService", () => {
  it("blocks screen enumeration before capture when permission is missing", () => {
    const changed = vi.fn();
    const service = new ComputerPermissionService(
      platform({ screenRecordingStatus: () => "denied" }),
      changed,
    );

    expect(() => service.requireScreenRecording("thread-1")).toThrow(
      ComputerPermissionRequiredError,
    );
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({
        required: true,
        blockingCapability: "screen_recording",
        ownerThreadId: "thread-1",
        screenRecording: "denied",
      }),
    );
  });

  it("blocks virtual input before executing an action", () => {
    const service = new ComputerPermissionService(
      platform({ accessibilityTrusted: () => false }),
    );

    expect(() => service.requireAccessibility()).toThrow(
      expect.objectContaining({
        capability: "accessibility",
        toolError: expect.objectContaining({
          retryable: false,
          userAction: expect.objectContaining({
            kind: "grant_permission",
          }),
        }),
      }),
    );
  });

  it("requests the native screen prompt only for an undetermined decision", async () => {
    let screenStatus = "not-determined" as
      | "not-determined"
      | "granted";
    const requestScreenRecording = vi.fn(() => {
      screenStatus = "granted";
      return true;
    });
    const openSettings = vi.fn(async () => undefined);
    const service = new ComputerPermissionService(
      platform({
        screenRecordingStatus: () => screenStatus,
        requestScreenRecording,
        openSettings,
      }),
    );

    await service.request("screen_recording");

    expect(requestScreenRecording).toHaveBeenCalledOnce();
    expect(openSettings).not.toHaveBeenCalled();
  });

  it("opens settings for a previously denied permission", async () => {
    const openSettings = vi.fn(async () => undefined);
    const service = new ComputerPermissionService(
      platform({
        screenRecordingStatus: () => "denied",
        openSettings,
      }),
    );

    await service.request("screen_recording");

    expect(openSettings).toHaveBeenCalledWith("screen_recording");
  });
});
