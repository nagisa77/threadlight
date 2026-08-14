import { PanelRight, Terminal } from "lucide-react";

import { useI18n } from "../../i18n.js";
import {
  ProjectOpenControl,
  type ProjectOpenerAdapter,
  type ProjectOpenerId,
  type ProjectOpenerOption,
} from "../../project-opener.js";

export function WorkspaceActions({
  projectId,
  threadId,
  standalone,
  projectOpener,
  projectOpeners,
  preferredProjectOpener,
  terminalAvailable,
  terminalOpen,
  terminalContext,
  workspaceAvailable,
  workspaceOpen,
  onToggleTerminal,
  onToggleWorkspace,
}: {
  projectId: string;
  threadId?: string;
  standalone: boolean;
  projectOpener?: ProjectOpenerAdapter;
  projectOpeners: readonly ProjectOpenerOption[];
  preferredProjectOpener: ProjectOpenerId;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalContext: string;
  workspaceAvailable: boolean;
  workspaceOpen: boolean;
  onToggleTerminal(): void;
  onToggleWorkspace(): void;
}) {
  const { t } = useI18n();
  return (
    <>
      {!standalone && projectOpener && projectOpeners.length > 0 && (
        <ProjectOpenControl
          adapter={projectOpener}
          projectId={projectId}
          threadId={threadId}
          preferred={preferredProjectOpener}
          openers={projectOpeners}
        />
      )}
      {terminalAvailable && (
        <button
          type="button"
          className={`header-terminal-button pressable ${terminalOpen ? "active" : ""}`}
          aria-label={`${terminalOpen ? t("closeTerminal") : t("openTerminal")} — ${terminalContext}`}
          aria-pressed={terminalOpen}
          title={`${terminalOpen ? t("closeTerminal") : t("openTerminal")} — ${terminalContext}（⌘J）`}
          onClick={onToggleTerminal}
        >
          <Terminal size={16} aria-hidden="true" />
        </button>
      )}
      {workspaceAvailable && (
        <button
          type="button"
          className={`header-terminal-button pressable ${workspaceOpen ? "active" : ""}`}
          aria-label={
            workspaceOpen ? t("closeRightPanel") : t("openRightPanel")
          }
          aria-pressed={workspaceOpen}
          title={`${workspaceOpen ? t("closeRightPanel") : t("openRightPanel")}（⇧⌘J）`}
          onClick={onToggleWorkspace}
        >
          <PanelRight size={16} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
