import type { AttachmentData } from "@threadlight/protocol";

/** Stable platform contracts shared by otherwise independent UI features. */
export interface ClipboardAdapter {
  writeText(text: string): Promise<void>;
}

export interface ConnectorAuthorizationAdapter {
  authorize<Result>(action: () => Promise<Result>): Promise<Result>;
}

export interface AttachmentStageAdapter {
  stage(file: File): Promise<AttachmentData>;
}

export interface AttachmentPreviewAdapter {
  imageUrl(attachment: AttachmentData): string | undefined;
  loadImageUrl?(attachment: AttachmentData): Promise<string | undefined>;
}

export interface PendingAttachment {
  id: string;
  file: File;
  previewUrl?: string;
}

export type VoiceInputStatus =
  "idle" | "requesting" | "recording" | "transcribing";

export type ComputerPermissionCapability = "screen_recording" | "accessibility";

export interface ComputerPermissionSnapshot {
  required: boolean;
  blockingCapability?: ComputerPermissionCapability;
  ownerThreadId?: string;
  screenRecording:
    "not-determined" | "granted" | "denied" | "restricted" | "unknown";
  accessibility: "granted" | "denied";
  relaunchRequired: boolean;
}

export interface ComputerPermissionAdapter {
  load(): Promise<ComputerPermissionSnapshot>;
  request(
    capability: ComputerPermissionCapability,
  ): Promise<ComputerPermissionSnapshot>;
  relaunch(): Promise<void>;
  subscribe(
    listener: (snapshot: ComputerPermissionSnapshot) => void,
  ): () => void;
}

export interface ComputerShareTarget {
  id: string;
  name: string;
  applicationName?: string;
}

export interface ComputerShareSnapshot {
  active: boolean;
  pictureInPicture: boolean;
  ownerThreadId?: string;
  targets: readonly ComputerShareTarget[];
}

export interface ComputerShareAdapter {
  load(): Promise<ComputerShareSnapshot>;
  showPictureInPicture(): Promise<ComputerShareSnapshot>;
  stop(): Promise<ComputerShareSnapshot>;
  subscribe(listener: (snapshot: ComputerShareSnapshot) => void): () => void;
}
