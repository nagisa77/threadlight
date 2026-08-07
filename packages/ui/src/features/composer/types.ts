import type { AttachmentData } from "@threadlight/protocol";

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
