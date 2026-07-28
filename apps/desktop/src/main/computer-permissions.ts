import type {
  DesktopComputerPermissionCapability,
  DesktopComputerPermissionSnapshot,
  DesktopComputerPermissionStatus,
} from "../shared/desktop-api.js";

export const COMPUTER_PERMISSION_ERROR_CODE =
  "computer_permission_required";

export interface ComputerPermissionPlatform {
  screenRecordingStatus(): DesktopComputerPermissionStatus;
  accessibilityTrusted(prompt: boolean): boolean;
  requestScreenRecording(): boolean;
  openSettings(capability: DesktopComputerPermissionCapability): Promise<void>;
}

export class ComputerPermissionRequiredError extends Error {
  readonly toolError: {
    code: typeof COMPUTER_PERMISSION_ERROR_CODE;
    retryable: false;
    userAction: {
      kind: "grant_permission";
      data: {
        capability: DesktopComputerPermissionCapability;
      };
    };
  };

  constructor(
    readonly capability: DesktopComputerPermissionCapability,
    message = permissionMessage(capability),
  ) {
    super(message);
    this.name = "ComputerPermissionRequiredError";
    this.toolError = {
      code: COMPUTER_PERMISSION_ERROR_CODE,
      retryable: false,
      userAction: {
        kind: "grant_permission",
        data: { capability },
      },
    };
  }
}

export class ComputerPermissionService {
  private required = false;
  private blockingCapability?: DesktopComputerPermissionCapability;
  private ownerThreadId?: string;
  private relaunchRequired = false;

  constructor(
    private readonly platform: ComputerPermissionPlatform,
    private readonly onChanged: (
      snapshot: DesktopComputerPermissionSnapshot,
    ) => void = () => undefined,
  ) {}

  snapshot(): DesktopComputerPermissionSnapshot {
    return {
      required: this.required,
      ...(this.blockingCapability
        ? { blockingCapability: this.blockingCapability }
        : {}),
      ...(this.ownerThreadId ? { ownerThreadId: this.ownerThreadId } : {}),
      screenRecording: this.platform.screenRecordingStatus(),
      accessibility: this.platform.accessibilityTrusted(false)
        ? "granted"
        : "denied",
      relaunchRequired: this.relaunchRequired,
    };
  }

  requireScreenRecording(ownerThreadId?: string): void {
    const status = this.platform.screenRecordingStatus();
    if (status === "granted") return;
    this.block("screen_recording", false, ownerThreadId);
  }

  requireAccessibility(ownerThreadId?: string): void {
    if (this.platform.accessibilityTrusted(false)) return;
    this.block("accessibility", false, ownerThreadId);
  }

  reportScreenCaptureFailure(ownerThreadId?: string): never {
    this.block("screen_recording", true, ownerThreadId);
  }

  async request(
    capability: DesktopComputerPermissionCapability,
  ): Promise<DesktopComputerPermissionSnapshot> {
    if (capability === "screen_recording") {
      const before = this.platform.screenRecordingStatus();
      if (before === "not-determined") {
        this.platform.requestScreenRecording();
      } else if (before !== "granted") {
        await this.platform.openSettings(capability);
      }
    } else if (!this.platform.accessibilityTrusted(true)) {
      await this.platform.openSettings(capability);
    }
    const next = this.snapshot();
    if (
      next.screenRecording === "granted" &&
      next.accessibility === "granted"
    ) {
      this.relaunchRequired = true;
    }
    this.emit();
    return this.snapshot();
  }

  refresh(): DesktopComputerPermissionSnapshot {
    const snapshot = this.snapshot();
    if (
      this.required &&
      snapshot.screenRecording === "granted" &&
      snapshot.accessibility === "granted"
    ) {
      this.relaunchRequired = true;
    }
    this.emit();
    return this.snapshot();
  }

  private block(
    capability: DesktopComputerPermissionCapability,
    relaunchRequired = false,
    ownerThreadId?: string,
  ): never {
    this.required = true;
    this.blockingCapability = capability;
    this.ownerThreadId = ownerThreadId ?? this.ownerThreadId;
    this.relaunchRequired ||= relaunchRequired;
    this.emit();
    throw new ComputerPermissionRequiredError(capability);
  }

  private emit(): void {
    this.onChanged(this.snapshot());
  }
}

function permissionMessage(
  capability: DesktopComputerPermissionCapability,
): string {
  return capability === "screen_recording"
    ? "Computer Use is waiting for Screen Recording permission. Complete the Threadlight permission prompt, then try again."
    : "Computer Use is waiting for Accessibility permission. Complete the Threadlight permission prompt, then try again.";
}
