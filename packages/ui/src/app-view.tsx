import { Suspense } from "react";
import { PanelLeftOpen } from "lucide-react";

import type { AppViewModel } from "./app-view-model.js";
import { useI18n } from "./i18n.js";
import { ProjectMemoryPage } from "./memory.js";
import { DiagnosticsPage } from "./diagnostics.js";
import { CommandPalette } from "./command-palette.js";
import {
  ExecutionApprovalGate,
  ExecutionPolicyPage,
} from "./execution-policy.js";
import { scopeFor, terminalWorkspaceContextLabel } from "./terminal-context.js";
import { ConversationSurface } from "./conversation-surface.js";
import { ComposerSurface } from "./composer-surface.js";
import { ConnectorSetupDialog } from "./capabilities.js";
import { MessageBookmarksDialog } from "./features/productivity/task-actions.js";
import { WorkspaceActions } from "./features/app-shell/workspace-actions.js";
import {
  DeferredTerminalPanel,
  DeferredView,
  DeferredWorkspacePanel,
  LazyAutomationsPage,
  LazyFirstRunGuide,
  LazySettingsPage,
  LazyTerminalPanel,
  LazyWorkspacePanel,
} from "./features/app-shell/deferred.js";
import { filterProjectsForTaskList } from "./features/navigation/project-sidebar.js";
import {
  DeleteConversationDialog,
  DeleteProjectDialog,
  ProjectEmptyState,
  RemoteProjectPathDialog,
  RemoteRuntimeDialog,
} from "./features/navigation/project-dialogs.js";
import { NavigationSidebar } from "./features/navigation/navigation-sidebar.js";
import {
  commandPaletteActions,
  commandPaletteTasks,
} from "./features/navigation/command-palette-model.js";

export function ThreadlightAppView({ model }: { model: AppViewModel }) {
  const { t } = useI18n();
  const {
    app: {
      client,
      settings,
      diagnostics,
      automations,
      projects,
      memory,
      search,
      projectOpener,
      preferredProjectOpener,
      terminal,
      workspace,
      executionPolicy,
      onLanguageChange,
      onThemeChange,
      onPreferredProjectOpenerChange,
    },
    navigation,
    navigationRuntime,
    sessionApi: { runningThreadIds },
    state,
    taskSession: { newTaskDraft },
    attachments,
    capabilities,
    voice,
    computer,
    delivery,
    productivity,
    currentProject,
    currentConversation,
    providerReady,
    firstRunRequired: _firstRunRequired,
    showFirstRunGuide,
    runFirstDemoTask,
    confirmDeleteConversation,
    confirmDeleteProject,
  } = model;
  const {
    mobileSidebar,
    sidebarOpen,
    sidebarCloseButton,
    sidebarOpenButton,
    view,
    setView,
    projectSnapshot,
    runtimeSettings,
    setRuntimeSettings,
    firstRunRetryDemo,
    hostSnapshot,
    projectError,
    switchingProject,
    remoteRuntimeOpen,
    setRemoteRuntimeOpen,
    remoteProjectPathOpen,
    setRemoteProjectPathOpen,
    remoteRuntimeBusy,
    remoteRuntimeError,
    setRemoteRuntimeError,
    commandPaletteOpen,
    commandPaletteMode,
    setCommandPaletteMode,
    pendingDelete,
    setPendingDelete,
    deleteError,
    setDeleteError,
    deletingConversation,
    pendingDeleteProject,
    setPendingDeleteProject,
    deleteProjectError,
    setDeleteProjectError,
    deletingProject,
    projectOpeners,
    commandPaletteTrigger,
  } = navigation;
  const {
    currentHost,
    showSidebar,
    hideSidebar,
    closeSidebarForNavigation,
    createThread,
    createProjectThread,
    createStandaloneThread,
    openProjectView,
    toggleProjectPinned,
    revealProjectInFinder,
    openCommandPalette,
    closeCommandPalette,
    selectCommandPaletteEntry,
    openProjectFolder,
    connectRemoteRuntime,
    activateHost,
    updateRemoteHost,
    deleteRemoteHost,
    updateConversationMetadata,
    selectConversation,
    reconnectRuntime,
  } = navigationRuntime;
  const {
    terminalOpen,
    setTerminalOpen,
    workspacePanelOpen,
    setWorkspacePanelOpen,
    workspacePanelMounted,
    workspacePanelWidth,
    setWorkspacePanelWidth,
    workspaceReviewRequest,
    workspaceDeliveryRequest,
    workspaceFileOpenRequest,
    conversationChanges,
    conversationChangesLoading,
    conversationChangesError,
    workspaceRoot,
    workspaceAgentPanel,
    automaticDelivery,
    refreshChanges,
    restoreChanges,
    retryAutomaticDelivery,
    undoAutomaticDelivery,
    beginResize,
    resizeBy,
  } = delivery;

  const sidebarProjects = filterProjectsForTaskList(
    (projectSnapshot?.projects ?? []).filter(
      (project) => project.scope !== "standalone",
    ),
    "",
    "all",
    runningThreadIds,
  );
  const standaloneProject = projectSnapshot?.projects.find(
    (project) => project.scope === "standalone",
  );
  const commandActions = commandPaletteActions({
    projectStandalone: currentProject?.scope === "standalone",
    memoryAvailable: Boolean(memory),
    workspaceAvailable: Boolean(workspace),
    workspaceOpen: workspacePanelOpen,
    terminalAvailable: Boolean(terminal),
    terminalOpen,
    diagnosticsAvailable: Boolean(diagnostics),
    automationsAvailable: Boolean(automations),
    settingsAvailable: Boolean(settings),
    t,
  });
  const commandTasks = commandPaletteTasks(
    projectSnapshot,
    runningThreadIds,
    t,
  );
  const taskTerminalBranch =
    currentConversation?.workspace?.mode === "worktree"
      ? currentConversation.workspace.branch
      : undefined;
  const originalTerminalBranch =
    automaticDelivery?.result?.targetBranch ??
    automaticDelivery?.preflight?.targetBranch ??
    (currentConversation?.workspace?.mode === "worktree"
      ? currentConversation.workspace.sourceBranch
      : undefined);
  const terminalScope = scopeFor({
    projectScope: currentProject?.scope,
    threadId: state.threadId,
    workspaceMode: currentConversation?.workspace?.mode,
  });
  const defaultTerminalContext = terminalWorkspaceContextLabel(
    terminalScope,
    terminalScope === "task" ? taskTerminalBranch : originalTerminalBranch,
    t,
  );
  const globalActions = currentProject ? (
    <WorkspaceActions
      projectId={currentProject.id}
      threadId={state.threadId}
      standalone={currentProject.scope === "standalone"}
      projectOpener={projectOpener}
      projectOpeners={projectOpeners}
      preferredProjectOpener={preferredProjectOpener}
      terminalAvailable={Boolean(terminal)}
      terminalOpen={terminalOpen}
      terminalContext={defaultTerminalContext}
      workspaceAvailable={Boolean(workspace)}
      workspaceOpen={workspacePanelOpen}
      onToggleTerminal={() => setTerminalOpen((open) => !open)}
      onToggleWorkspace={() => setWorkspacePanelOpen((open) => !open)}
    />
  ) : null;
  const globalActionsInPanel = Boolean(
    workspacePanelOpen && workspace && currentProject,
  );

  return (
    <div
      className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-hidden"}`}
    >
      <NavigationSidebar
        open={sidebarOpen}
        mobile={mobileSidebar}
        closeButtonRef={sidebarCloseButton}
        currentProject={currentProject}
        connection={state.connection}
        threadId={state.threadId}
        fallbackTaskTitle={state.messages[0]?.text}
        disabled={switchingProject || voice.status !== "idle"}
        automationsEnabled={Boolean(automations)}
        view={view}
        projectsAvailable={Boolean(projects)}
        projects={projectSnapshot}
        sidebarProjects={sidebarProjects}
        standaloneProject={standaloneProject}
        runningThreadIds={runningThreadIds}
        computerThreadId={computer.shareSnapshot?.ownerThreadId}
        searchAvailable={Boolean(search)}
        memoryEnabled={Boolean(memory)}
        securityEnabled={Boolean(executionPolicy)}
        diagnostics={diagnostics}
        canRevealProjects={Boolean(workspace?.revealSystemFile)}
        canUpdateProjects={Boolean(projects?.updateProject)}
        canDeleteProjects={Boolean(projects?.deleteProject)}
        settingsEnabled={Boolean(settings)}
        currentHost={currentHost}
        canConnectRemote={Boolean(projects?.connectRemote)}
        searchTriggerRef={commandPaletteTrigger}
        onHide={() => hideSidebar(true)}
        onCreateTask={() => void createThread()}
        onNavigate={(nextView) => {
          voice.cancel();
          setView(nextView);
          closeSidebarForNavigation();
        }}
        onSearch={() => openCommandPalette("all")}
        onOpenProject={() => void openProjectFolder()}
        onCreateProjectTask={createProjectThread}
        onOpenProjectView={openProjectView}
        onRevealProject={revealProjectInFinder}
        onToggleProjectPinned={toggleProjectPinned}
        onDeleteProject={(project) => {
          closeSidebarForNavigation();
          setDeleteProjectError(undefined);
          setPendingDeleteProject(project);
        }}
        onSelectConversation={(projectId, threadId) =>
          void selectConversation(projectId, threadId)
        }
        onUpdateConversation={updateConversationMetadata}
        onDeleteConversation={(projectId, conversation) => {
          closeSidebarForNavigation();
          setDeleteError(undefined);
          setPendingDelete({ projectId, conversation });
        }}
        onOpenRemoteRuntime={() => {
          closeSidebarForNavigation();
          setRemoteRuntimeError(undefined);
          setRemoteRuntimeOpen(true);
        }}
      />

      <main
        ref={workspaceRoot}
        className={`workspace ${terminalOpen ? "has-terminal" : ""} ${workspacePanelOpen && workspace && currentProject ? "has-workspace-panel" : ""} ${attachments.dragging ? "is-dragging-files" : ""}`}
        style={
          workspacePanelOpen &&
          workspace &&
          currentProject &&
          workspacePanelWidth
            ? {
                gridTemplateColumns: `minmax(360px, 1fr) ${workspacePanelWidth}px`,
              }
            : undefined
        }
        onPaste={attachments.onPaste}
        onDragEnter={attachments.onDragEnter}
        onDragOver={attachments.onDragOver}
        onDragLeave={attachments.onDragLeave}
        onDrop={attachments.onDrop}
      >
        {!sidebarOpen && (
          <button
            ref={sidebarOpenButton}
            type="button"
            className="sidebar-reveal-button pressable"
            aria-label={t("showSidebar")}
            title={t("showSidebar")}
            aria-controls="app-sidebar"
            aria-expanded={false}
            onClick={showSidebar}
          >
            <PanelLeftOpen size={17} />
          </button>
        )}
        <div className="workspace-primary">
          <PrimaryView model={model} />
        </div>
        {!globalActionsInPanel &&
          currentProject &&
          (projectOpener || terminal || workspace) && (
            <div className="workspace-global-actions">{globalActions}</div>
          )}
        {workspace && currentProject && workspacePanelMounted.current && (
          <Suspense
            fallback={
              <DeferredWorkspacePanel
                hidden={!workspacePanelOpen}
                label={t("loading")}
              />
            }
          >
            <LazyWorkspacePanel
              adapter={workspace}
              terminal={terminal}
              projectId={currentProject.id}
              threadId={state.threadId}
              projectName={currentProject.name}
              remoteFileRoot={
                currentProject.runtime?.kind === "remote"
                  ? currentProject.runtime.workspacePath
                  : undefined
              }
              changes={conversationChanges}
              changesLoading={conversationChangesLoading}
              changesError={conversationChangesError}
              reviewRequest={workspaceReviewRequest}
              deliveryRequest={workspaceDeliveryRequest}
              fileOpenRequest={workspaceFileOpenRequest}
              agentPanel={workspaceAgentPanel}
              agentControls={{ client, threadId: state.threadId }}
              hidden={!workspacePanelOpen}
              onResizeStart={beginResize}
              onResizeBy={resizeBy}
              onResetSize={() => setWorkspacePanelWidth(undefined)}
              onRefreshChanges={() => void refreshChanges()}
              onRestoreChanges={
                workspace.restoreChanges ? restoreChanges : undefined
              }
              restoreDisabled={state.isRunning}
              deliveryEnabled={
                currentConversation?.workspace?.mode === "worktree"
              }
              deliveryDisabled={state.isRunning}
              automaticDelivery={automaticDelivery}
              taskBranch={taskTerminalBranch}
              originalBranch={originalTerminalBranch}
              taskWorkspaceAvailable={terminalScope === "task"}
              generatePullRequestDescription={
                state.threadId && conversationChanges
                  ? () =>
                      client.generatePullRequestDescription(
                        state.threadId as string,
                        conversationChanges.files
                          .filter((file) => !file.localOnly)
                          .map((file) => ({
                            path: file.path,
                            status: file.status,
                            additions: file.additions,
                            deletions: file.deletions,
                            binary: file.binary,
                          })),
                      )
                  : undefined
              }
              onRetryAutomaticDelivery={() => void retryAutomaticDelivery()}
              onUndoAutomaticDelivery={undoAutomaticDelivery}
              taskTitle={currentConversation?.title}
              onDiscardTask={
                currentConversation?.workspace?.mode === "worktree"
                  ? () =>
                      setPendingDelete({
                        projectId: currentProject.id,
                        conversation: currentConversation,
                        mode: "discard",
                      })
                  : undefined
              }
              toolbarActions={globalActionsInPanel ? globalActions : undefined}
            />
          </Suspense>
        )}
        {terminalOpen && terminal && currentProject && (
          <Suspense fallback={<DeferredTerminalPanel label={t("loading")} />}>
            <LazyTerminalPanel
              key={`${currentProject.id}:${state.threadId ?? ""}`}
              adapter={terminal}
              workspace={workspace}
              projectId={currentProject.id}
              threadId={state.threadId}
              projectName={currentProject.name}
              taskBranch={taskTerminalBranch}
              originalBranch={originalTerminalBranch}
              defaultWorkspace={terminalScope}
              taskWorkspaceAvailable={terminalScope === "task"}
              onClose={() => setTerminalOpen(false)}
            />
          </Suspense>
        )}
      </main>
      {commandPaletteOpen && search && currentProject && (
        <CommandPalette
          adapter={search}
          projectId={currentProject.id}
          threadId={state.threadId}
          mode={commandPaletteMode}
          actions={commandActions}
          tasks={commandTasks}
          onModeChange={setCommandPaletteMode}
          onClose={() => closeCommandPalette()}
          onSelect={(entry) => void selectCommandPaletteEntry(entry)}
        />
      )}
      <ApplicationDialogs model={model} />
      {executionPolicy && <ExecutionApprovalGate adapter={executionPolicy} />}
    </div>
  );
}

function PrimaryView({ model }: { model: AppViewModel }) {
  const { t } = useI18n();
  const {
    app: {
      settings,
      diagnostics,
      automations,
      projects,
      memory,
      executionPolicy,
      onLanguageChange,
      onThemeChange,
      onPreferredProjectOpenerChange,
    },
    navigation: {
      view,
      setView: _setView,
      runtimeSettings,
      setRuntimeSettings,
      firstRunRetryDemo,
      projectError,
      switchingProject,
      setRemoteRuntimeOpen,
      projectOpeners,
    },
    navigationRuntime: {
      currentHost,
      openProjectFolder,
      createStandaloneThread,
      selectConversation,
      reconnectRuntime,
    },
    currentProject,
    providerReady,
    showFirstRunGuide,
    runFirstDemoTask,
  } = model;
  if (showFirstRunGuide && settings && runtimeSettings) {
    return (
      <Suspense fallback={<DeferredView label={t("loading")} />}>
        <LazyFirstRunGuide
          key={firstRunRetryDemo ? "demo-retry" : "first-run"}
          adapter={settings}
          settings={runtimeSettings}
          project={currentProject}
          connectionReady={providerReady}
          initialStep={firstRunRetryDemo ? "demo" : undefined}
          onSettingsSaved={setRuntimeSettings}
          onLanguageChange={onLanguageChange}
          onThemeChange={onThemeChange}
          onRuntimeRestart={reconnectRuntime}
          onOpenProject={() => openProjectFolder()}
          onRunDemo={runFirstDemoTask}
        />
      </Suspense>
    );
  }
  if (
    view === "memory" &&
    memory &&
    currentProject &&
    currentProject.scope !== "standalone"
  ) {
    return (
      <ProjectMemoryPage
        adapter={memory}
        projectId={currentProject.id}
        projectName={currentProject.name}
      />
    );
  }
  if (view === "diagnostics" && diagnostics && currentProject) {
    return (
      <DiagnosticsPage
        adapter={diagnostics}
        projectId={currentProject.id}
        projectName={currentProject.name}
        conversations={currentProject.conversations}
      />
    );
  }
  if (view === "automations" && automations && currentProject) {
    return (
      <Suspense fallback={<DeferredView label={t("loading")} />}>
        <LazyAutomationsPage
          adapter={automations}
          projectId={currentProject.id}
          projectName={currentProject.name}
          onOpenThread={(threadId) =>
            void selectConversation(currentProject.id, threadId)
          }
        />
      </Suspense>
    );
  }
  if (view === "settings" && settings) {
    return (
      <Suspense fallback={<DeferredView label={t("loading")} />}>
        <LazySettingsPage
          adapter={settings}
          secretStorageBoundary={
            currentHost?.kind === "remote" ? "host-file" : "system"
          }
          onRuntimeRestart={reconnectRuntime}
          onLanguageChange={onLanguageChange}
          onThemeChange={onThemeChange}
          projectOpeners={projectOpeners}
          onPreferredProjectOpenerChange={onPreferredProjectOpenerChange}
          onSettingsChange={setRuntimeSettings}
        />
      </Suspense>
    );
  }
  if (view === "security" && executionPolicy && currentProject) {
    return (
      <ExecutionPolicyPage
        adapter={executionPolicy}
        projectId={currentProject.id}
        projectName={currentProject.name}
      />
    );
  }
  if (projects && !currentProject) {
    return (
      <ProjectEmptyState
        error={projectError}
        opening={switchingProject}
        onOpen={() => void openProjectFolder()}
        onCreateStandalone={
          projects.createStandalone
            ? () => void createStandaloneThread()
            : undefined
        }
        onConnectRemote={
          projects.connectRemote ? () => setRemoteRuntimeOpen(true) : undefined
        }
      />
    );
  }
  return (
    <>
      <ConversationSurface model={model} />
      <ComposerSurface model={model} />
    </>
  );
}

function ApplicationDialogs({ model }: { model: AppViewModel }) {
  const { t } = useI18n();
  const {
    app: { projects },
    navigation: {
      projectSnapshot,
      hostSnapshot,
      projectError,
      switchingProject,
      remoteRuntimeOpen,
      setRemoteRuntimeOpen,
      remoteProjectPathOpen,
      setRemoteProjectPathOpen,
      remoteRuntimeBusy,
      remoteRuntimeError,
      setRemoteRuntimeError,
      pendingDelete,
      setPendingDelete,
      deleteError,
      setDeleteError,
      deletingConversation,
      pendingDeleteProject,
      setPendingDeleteProject,
      deleteProjectError,
      setDeleteProjectError,
      deletingProject,
    },
    navigationRuntime: {
      currentHost,
      openProjectFolder,
      connectRemoteRuntime,
      activateHost,
      updateRemoteHost,
      deleteRemoteHost,
    },
    state,
    capabilities: {
      connectorSetup,
      connectorBusy,
      connectorError,
      connectConnector,
      disconnectConnector,
      closeConnectorSetup,
    },
    delivery: { conversationChanges },
    productivity,
    taskRuntime: { jumpToMessage },
    confirmDeleteConversation,
    confirmDeleteProject,
  } = model;
  return (
    <>
      {pendingDelete && (
        <DeleteConversationDialog
          conversation={pendingDelete.conversation}
          discard={pendingDelete.mode === "discard"}
          metadataOnly={pendingDelete.mode === "metadata"}
          localDataFiles={
            pendingDelete.mode === "discard" &&
            pendingDelete.conversation.id === state.threadId
              ? (conversationChanges?.files.filter((file) => file.localOnly)
                  .length ?? 0)
              : 0
          }
          deleting={deletingConversation}
          error={deleteError}
          onCancel={() => {
            setPendingDelete(undefined);
            setDeleteError(undefined);
          }}
          onConfirm={() => void confirmDeleteConversation()}
        />
      )}
      {pendingDeleteProject && (
        <DeleteProjectDialog
          project={pendingDeleteProject}
          deleting={deletingProject}
          error={deleteProjectError}
          onCancel={() => {
            setPendingDeleteProject(undefined);
            setDeleteProjectError(undefined);
          }}
          onConfirm={() => void confirmDeleteProject()}
        />
      )}
      {remoteRuntimeOpen && projects?.connectRemote && (
        <RemoteRuntimeDialog
          hosts={hostSnapshot}
          activeHostId={hostSnapshot?.activeHostId}
          busy={remoteRuntimeBusy || switchingProject}
          error={remoteRuntimeError}
          onCancel={() => {
            if (remoteRuntimeBusy) return;
            setRemoteRuntimeOpen(false);
            setRemoteRuntimeError(undefined);
          }}
          onActivate={(hostId) => void activateHost(hostId)}
          onUpdate={
            projects.updateRemoteHost
              ? (input) => void updateRemoteHost(input)
              : undefined
          }
          onDelete={(hostId) => void deleteRemoteHost(hostId)}
          onConnect={(input) => void connectRemoteRuntime(input)}
          onResetError={() => setRemoteRuntimeError(undefined)}
        />
      )}
      {remoteProjectPathOpen && (
        <RemoteProjectPathDialog
          key={currentHost?.id ?? "remote"}
          busy={switchingProject}
          error={projectError}
          hostId={currentHost?.id ?? "remote"}
          hostName={currentHost?.name ?? t("remoteHost")}
          recentProjects={(projectSnapshot?.projects ?? [])
            .filter((project) => project.scope !== "standalone")
            .map((project) => ({
              name: project.name,
              path: project.basePath,
              lastOpenedAt: project.lastOpenedAt,
            }))}
          onBrowse={projects?.listRemoteDirectories}
          onCancel={() => {
            if (!switchingProject) setRemoteProjectPathOpen(false);
          }}
          onOpen={(path) => void openProjectFolder(path)}
        />
      )}
      {connectorSetup && (
        <ConnectorSetupDialog
          capability={connectorSetup.capability}
          status={connectorSetup.status}
          busy={connectorBusy}
          error={connectorError}
          onCancel={closeConnectorSetup}
          onConnect={(clientId, clientSecret) =>
            void connectConnector(clientId, clientSecret)
          }
          onDisconnect={() => void disconnectConnector()}
        />
      )}
      {productivity.bookmarksOpen && (
        <MessageBookmarksDialog
          messages={productivity.bookmarkedMessages}
          onClose={() => productivity.setBookmarksOpen(false)}
          onJump={jumpToMessage}
          onRemove={productivity.toggleBookmark}
        />
      )}
    </>
  );
}
