import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ThreadlightClient } from "@threadlight/client";

import type { AutomationAdapter } from "../../automations.js";
import type { DiagnosticsAdapter } from "../../diagnostics.js";
import type { ExecutionPolicyAdapter } from "../../execution-policy.js";
import { I18nProvider, isLanguage, type Language } from "../../i18n.js";
import type { ProjectMemoryAdapter } from "../../memory.js";
import type {
  ProjectOpenerAdapter,
  ProjectOpenerId,
} from "../../project-opener.js";
import type { ProjectsAdapter, ProjectsSnapshot } from "../../projects.js";
import type { SearchAdapter } from "../../command-palette.js";
import type { SettingsAdapter, SettingsSnapshot } from "../../settings.js";
import {
  isThemePreference,
  ThemeProvider,
  type ThemePreference,
} from "../../theme.js";
import type { TerminalAdapter } from "../../terminal.js";
import type { VoiceInputAdapter } from "../../voice-input.js";
import type { WorkspaceAdapter } from "../../workspace-panel.js";
import type {
  AttachmentPreviewAdapter,
  AttachmentStageAdapter,
  ClipboardAdapter,
  ConnectorAuthorizationAdapter,
  ComputerPermissionAdapter,
  ComputerShareAdapter,
} from "../shared/adapters.js";

export interface ThreadlightAppProps {
  client: ThreadlightClient;
  initialThreadId?: string;
  initialLanguage?: Language;
  initialSettings?: SettingsSnapshot;
  initialProjects?: ProjectsSnapshot;
  onInitialViewReady?(): void;
  onThreadChange?(threadId?: string): void;
  onLanguageChange?(language: Language): void;
  clipboard?: ClipboardAdapter;
  settings?: SettingsAdapter;
  diagnostics?: DiagnosticsAdapter;
  automations?: AutomationAdapter;
  projects?: ProjectsAdapter;
  memory?: ProjectMemoryAdapter;
  search?: SearchAdapter;
  voiceInput?: VoiceInputAdapter;
  connectorAuthorization?: ConnectorAuthorizationAdapter;
  attachmentStage?: AttachmentStageAdapter;
  attachmentPreview?: AttachmentPreviewAdapter;
  computerShare?: ComputerShareAdapter;
  computerPermissions?: ComputerPermissionAdapter;
  terminal?: TerminalAdapter;
  workspace?: WorkspaceAdapter;
  projectOpener?: ProjectOpenerAdapter;
  executionPolicy?: ExecutionPolicyAdapter;
}

export interface AppShellState {
  onLanguageChange(language: Language): void;
  onThemeChange(theme: ThemePreference): void;
  preferredProjectOpener: ProjectOpenerId;
  onPreferredProjectOpenerChange(opener: ProjectOpenerId): void;
}

export function ThreadlightAppShell({
  app,
  children,
}: {
  app: ThreadlightAppProps;
  children(state: AppShellState): ReactNode;
}) {
  const [language, setLanguage] = useState<Language>(
    () =>
      (isLanguage(app.initialSettings?.language)
        ? app.initialSettings.language
        : app.initialLanguage) ?? "zh-CN",
  );
  const [theme, setTheme] = useState<ThemePreference>(
    () =>
      (isThemePreference(app.initialSettings?.theme)
        ? app.initialSettings.theme
        : undefined) ?? "system",
  );
  const [preferredProjectOpener, setPreferredProjectOpener] =
    useState<ProjectOpenerId>(
      () => app.initialSettings?.preferredProjectOpener ?? "",
    );

  const changeLanguage = useCallback(
    (nextLanguage: Language) => {
      setLanguage(nextLanguage);
      app.onLanguageChange?.(nextLanguage);
    },
    [app.onLanguageChange],
  );

  useEffect(() => {
    if (app.initialSettings) return;
    let active = true;
    void app.settings
      ?.load()
      .then((snapshot) => {
        if (active && isLanguage(snapshot.language)) {
          changeLanguage(snapshot.language);
        }
        if (active && isThemePreference(snapshot.theme)) {
          setTheme(snapshot.theme);
        }
        if (active) {
          setPreferredProjectOpener(snapshot.preferredProjectOpener);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [app.initialSettings, app.settings, changeLanguage]);

  return (
    <ThemeProvider preference={theme}>
      <I18nProvider language={language}>
        {children({
          onLanguageChange: changeLanguage,
          onThemeChange: setTheme,
          preferredProjectOpener,
          onPreferredProjectOpenerChange: setPreferredProjectOpener,
        })}
      </I18nProvider>
    </ThemeProvider>
  );
}
