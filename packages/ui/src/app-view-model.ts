import type { ConversationAccessMode } from "@threadlight/protocol";

import type { ConversationSummary, ProjectSummary } from "./projects.js";
import type { DraftPersistenceStatus } from "./features/productivity/controller.js";
import type { SessionState } from "./features/task-session/session.js";
import type {
  AppShellState,
  ThreadlightAppProps,
} from "./features/app-shell/app-shell.js";
import type { useNavigationController } from "./features/navigation/controller.js";
import type { useNavigationRuntime } from "./features/navigation/runtime-controller.js";
import type { useThreadlightSession } from "./features/task-session/session.js";
import type { useTaskSessionController } from "./features/task-session/controller.js";
import type { useTaskSessionRuntime } from "./features/task-session/runtime-controller.js";
import type { useComposerController } from "./features/composer/controller.js";
import type { useComposerRuntime } from "./features/composer/runtime-controller.js";
import type { useAttachmentController } from "./features/composer/attachment-controller.js";
import type { useCapabilityController } from "./features/composer/capability-controller.js";
import type { useVoiceInputController } from "./features/composer/voice-input-controller.js";
import type { useComputerController } from "./features/task-session/computer-controller.js";
import type { useDeliveryRuntime } from "./features/delivery/runtime-controller.js";
import type { useTaskProductivity } from "./features/productivity/controller.js";

export interface AppViewModel {
  app: ThreadlightAppProps & AppShellState;
  navigation: ReturnType<typeof useNavigationController>;
  navigationRuntime: ReturnType<typeof useNavigationRuntime>;
  sessionApi: ReturnType<typeof useThreadlightSession>;
  state: SessionState;
  taskSession: ReturnType<typeof useTaskSessionController>;
  taskRuntime: ReturnType<typeof useTaskSessionRuntime>;
  composer: ReturnType<typeof useComposerController>;
  composerRuntime: ReturnType<typeof useComposerRuntime>;
  attachments: ReturnType<typeof useAttachmentController>;
  capabilities: ReturnType<typeof useCapabilityController>;
  voice: ReturnType<typeof useVoiceInputController>;
  computer: ReturnType<typeof useComputerController>;
  delivery: ReturnType<typeof useDeliveryRuntime>;
  productivity: ReturnType<typeof useTaskProductivity>;
  currentProject?: ProjectSummary;
  currentConversation?: ConversationSummary;
  providerReady: boolean;
  firstRunRequired: boolean;
  showFirstRunGuide: boolean;
  selectedAccessMode: ConversationAccessMode;
  selectedProvider?: string;
  selectedModel?: string;
  setConversationModel(selection: { provider: string; model: string }): void;
  headerTitle: string;
  draftStatus?: DraftPersistenceStatus;
  runFirstDemoTask(accessMode: ConversationAccessMode): Promise<void>;
  requestMissingThreadMetadataDelete(): void;
  confirmDeleteConversation(): Promise<void>;
  confirmDeleteProject(): Promise<void>;
}
