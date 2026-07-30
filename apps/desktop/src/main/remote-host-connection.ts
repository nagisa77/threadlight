import {
  HttpHostClient,
  type HostAttachmentUpload,
  type HostAudioTranscriptionRequest,
} from "@threadlight/client";
import type {
  AttachmentData,
  HostProviderDiagnostic,
  HostProviderTestRequest,
  HostProjectsSnapshot,
  HostProjectDiagnosticsSnapshot,
  HostSearchRequest,
  HostSearchResult,
  HostSettingsSnapshot,
  HostSettingsUpdate,
  ThreadlightHostHealth,
} from "@threadlight/protocol";

export class RemoteHostConnection {
  readonly client: HttpHostClient;

  constructor(
    readonly endpoint: string,
    readonly token: string,
  ) {
    this.client = new HttpHostClient({ endpoint, token });
  }

  health(): Promise<ThreadlightHostHealth> {
    return this.client.health();
  }

  projects(): Promise<HostProjectsSnapshot> {
    return this.client.projects();
  }

  diagnostics(projectId: string): Promise<HostProjectDiagnosticsSnapshot> {
    return this.client.diagnostics(projectId);
  }

  search(request: HostSearchRequest): Promise<readonly HostSearchResult[]> {
    return this.client.search(request);
  }

  settings(): Promise<HostSettingsSnapshot> {
    return this.client.settings();
  }

  updateSettings(update: HostSettingsUpdate): Promise<HostSettingsSnapshot> {
    return this.client.updateSettings(update);
  }

  uploadAttachment(upload: HostAttachmentUpload): Promise<AttachmentData> {
    return this.client.uploadAttachment(upload);
  }

  downloadAttachment(
    projectId: string,
    attachmentId: string,
  ): Promise<ArrayBuffer> {
    return this.client.downloadAttachment(projectId, attachmentId);
  }

  testProvider(
    request: HostProviderTestRequest,
  ): Promise<HostProviderDiagnostic> {
    return this.client.testProvider(request);
  }

  transcribeAudio(
    request: HostAudioTranscriptionRequest,
  ): Promise<string> {
    return this.client.transcribeAudio(request);
  }
}
