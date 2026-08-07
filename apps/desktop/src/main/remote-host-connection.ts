import {
  HttpHostClient,
  type HostAttachmentUpload,
  type HostAudioTranscriptionRequest,
} from "@threadlight/client";
import type {
  AttachmentData,
  HostAutomationCreateRequest,
  HostAutomationsSnapshot,
  HostAutomationUpdateRequest,
  HostProviderDiagnostic,
  HostProviderTestRequest,
  HostProjectsSnapshot,
  HostProjectDiagnosticBundle,
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

  diagnosticBundle(projectId: string): Promise<HostProjectDiagnosticBundle> {
    return this.client.diagnosticBundle(projectId);
  }

  automations(projectId: string): Promise<HostAutomationsSnapshot> {
    return this.client.automations(projectId);
  }

  createAutomation(
    request: HostAutomationCreateRequest,
  ): Promise<HostAutomationsSnapshot> {
    return this.client.createAutomation(request);
  }

  updateAutomation(
    request: HostAutomationUpdateRequest,
  ): Promise<HostAutomationsSnapshot> {
    return this.client.updateAutomation(request);
  }

  deleteAutomation(
    projectId: string,
    id: string,
  ): Promise<HostAutomationsSnapshot> {
    return this.client.deleteAutomation(projectId, id);
  }

  runAutomation(
    projectId: string,
    id: string,
  ): Promise<HostAutomationsSnapshot> {
    return this.client.runAutomation(projectId, id);
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
