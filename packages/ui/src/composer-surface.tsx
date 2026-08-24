import {
  ArrowUp,
  CircleStop,
  KeyRound,
  LoaderCircle,
  Paperclip,
  Plus,
} from "lucide-react";
import type { TaskDevelopmentMode } from "@threadlight/protocol";

import type { AppViewModel } from "./app-view-model.js";
import { useI18n } from "./i18n.js";
import { CapabilityChips, CapabilityMenu } from "./capabilities.js";
import { ConversationAccessControl } from "./execution-policy.js";
import {
  activateComposerMenuOnPointerDown,
  preserveComposerFocusOnPointerDown,
} from "./features/composer/controller.js";
import { composerSubmissionAvailable } from "./composer-submission.js";
import { ComposerQueue } from "./features/composer/composer-queue.js";
import { DevelopmentModeControl } from "./features/composer/development-mode.js";
import { ModelSelector } from "./features/composer/model-selector.js";
import { VoiceInputButton } from "./features/composer/voice-input-button.js";
import { ComposerProductivityStatus } from "./features/productivity/composer-status.js";
import { projectSupportsDevelopmentMode } from "./features/app-shell/readiness.js";
import { ownsActiveComputerShare } from "./features/navigation/project-sidebar.js";
import {
  AgentTreePanel,
  ComposerAttachments,
  attachmentHint,
} from "./features/task-session/conversation-content.js";
import {
  ComputerPermissionCard,
  ComputerShareStatus,
  ComposerFloatingControls,
} from "./features/task-session/turn-status.js";

export function ComposerSurface({ model }: { model: AppViewModel }) {
  const { t } = useI18n();
  const {
    app: { client, voiceInput, executionPolicy, projects },
    navigation: { setView, runtimeSettings, switchingProject },
    sessionApi: {
      setThreadModel,
      injectQueuedTurn,
      reorderQueuedTurn,
      cancelQueuedTurn,
      interrupt,
    },
    state,
    taskSession: {
      newTaskDraft,
      developmentMode,
      setDevelopmentMode,
      draftAccessMode,
      setDraftAccessMode,
      setDraftModel,
    },
    taskRuntime: {
      showJumpToLatest,
      jumpToLatest,
      updateAccessMode: updateConversationAccessMode,
    },
    composer: {
      input,
      setInput,
      submitting,
      inputValueRef,
      composerMode: _composerMode,
      setComposerMode,
      composerRoot,
      textarea,
      historyIndex,
      historyDraft,
    },
    composerRuntime: {
      dismissErrors,
      submit,
      handleCompositionStart,
      handleCompositionEnd,
      handleKeyDown,
    },
    attachments: {
      attachments,
      preparing,
      error: attachmentError,
      dragging,
      fileInput,
      add,
      remove,
    },
    capabilities: {
      selected,
      setSelected,
      query,
      setQuery,
      activeIndex,
      addMenuOpen,
      setAddMenuOpen,
      loading,
      filtered,
      addActions,
      itemCount,
      toggleAddMenu,
      updateQuery,
      selectAddAction,
      selectCapability,
      manageConnector,
    },
    voice: {
      status: voiceStatus,
      error: voiceError,
      start: startVoiceInput,
      stop: stopVoiceInput,
    },
    computer: {
      shareSnapshot,
      shareError,
      permissionSnapshot,
      permissionBusy,
      permissionError,
      showingShare,
      stoppingShare,
      requestPermission,
      refreshPermissions,
      relaunchForPermissions,
      stopShare,
      showSharePreview,
    },
    delivery: {
      conversationChanges,
      workspaceAgentPanel,
      hasConversationChanges,
      openLocalFile,
      openReviewPanel,
    },
    productivity: _productivity,
    currentProject,
    currentConversation,
    providerReady,
    firstRunRequired,
    selectedAccessMode,
    selectedProvider,
    selectedModel,
    draftStatus,
  } = model;

  const currentDevelopmentMode: TaskDevelopmentMode = newTaskDraft
    ? developmentMode
    : currentConversation?.workspace?.mode === "worktree"
      ? "worktree"
      : "local";
  const showDevelopmentMode = Boolean(
    projects && projectSupportsDevelopmentMode(currentProject),
  );
  const developmentModeEditable = Boolean(
    showDevelopmentMode && newTaskDraft && !state.threadId,
  );
  const hasContext = Boolean(
    (permissionSnapshot?.required &&
      (!permissionSnapshot.ownerThreadId ||
        permissionSnapshot.ownerThreadId === state.threadId)) ||
    ownsActiveComputerShare(shareSnapshot, state.threadId) ||
    attachments.length > 0 ||
    state.queuedTurns.length > 0 ||
    selected.length > 0 ||
    query ||
    addMenuOpen,
  );

  return (
    <>
      <footer className="composer-wrap">
        <ComposerFloatingControls
          jumpVisible={showJumpToLatest && state.messages.length > 0}
          plan={state.plan}
          changes={hasConversationChanges ? conversationChanges : undefined}
          onJump={jumpToLatest}
          onOpenChanges={openReviewPanel}
        />
        <AgentTreePanel
          tree={state.agentTree}
          live
          onOpenInPanel={workspaceAgentPanel.open}
        />
        {!providerReady && (
          <button
            type="button"
            className="composer-provider-gate pressable"
            onClick={() => setView(firstRunRequired ? "thread" : "settings")}
          >
            <KeyRound size={14} />
            <span>
              <strong>{t("providerRequired")}</strong>
              <small>{t("providerRequiredDescription")}</small>
            </span>
            <span>{t("configureProvider")}</span>
          </button>
        )}
        <div
          ref={composerRoot}
          className={`composer${voiceStatus !== "idle" ? " is-voice-active" : ""}${voiceStatus === "recording" ? " is-recording" : ""}${hasContext ? " has-context" : ""}`}
        >
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            multiple
            tabIndex={-1}
            onChange={(event) => {
              add([...(event.currentTarget.files ?? [])]);
              event.currentTarget.value = "";
            }}
          />
          {permissionSnapshot?.required &&
            (!permissionSnapshot.ownerThreadId ||
              permissionSnapshot.ownerThreadId === state.threadId) && (
              <ComputerPermissionCard
                snapshot={permissionSnapshot}
                busy={permissionBusy}
                error={permissionError}
                onRequest={(capability) => void requestPermission(capability)}
                onRefresh={() => void refreshPermissions()}
                onRelaunch={() => void relaunchForPermissions()}
              />
            )}
          {ownsActiveComputerShare(shareSnapshot, state.threadId) && (
            <ComputerShareStatus
              snapshot={shareSnapshot}
              busy={showingShare || stoppingShare}
              stopping={stoppingShare}
              error={shareError}
              onShow={() => void showSharePreview()}
              onStop={() => void stopShare()}
            />
          )}
          {attachments.length > 0 && (
            <ComposerAttachments
              attachments={attachments}
              onRemove={remove}
              disabled={preparing}
            />
          )}
          {state.queuedTurns.length > 0 && (
            <ComposerQueue
              items={state.queuedTurns}
              onInject={injectQueuedTurn}
              onReorder={reorderQueuedTurn}
              onCancel={cancelQueuedTurn}
            />
          )}
          <CapabilityChips
            capabilities={selected}
            disabled={state.isRunning}
            onManage={manageConnector}
            onPreview={(capability) => {
              if (capability.localPath) {
                openLocalFile({ path: capability.localPath });
              }
            }}
            onRemove={(capability) =>
              setSelected((current) => {
                if (capability.id === "tool:plan") setComposerMode("default");
                return current.filter(({ id }) => id !== capability.id);
              })
            }
          />
          {(query || addMenuOpen) && (
            <CapabilityMenu
              actions={addActions}
              capabilities={filtered}
              activeIndex={Math.min(activeIndex, Math.max(0, itemCount - 1))}
              loading={loading}
              onSelectAction={selectAddAction}
              onSelect={selectCapability}
            />
          )}
          <textarea
            ref={textarea}
            value={input}
            rows={2}
            placeholder={
              voiceStatus === "recording"
                ? t("listening")
                : providerReady
                  ? t("askThreadlight")
                  : t("configureProviderToStart")
            }
            disabled={state.connection !== "ready" || !providerReady}
            onChange={(event) => {
              const value = event.target.value;
              historyIndex.current = -1;
              historyDraft.current = "";
              setInput(value);
              inputValueRef.current = value;
              if (state.isRunning) setQuery(undefined);
              else updateQuery(value, event.target.selectionStart);
              dismissErrors();
            }}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onKeyDown={handleKeyDown}
            onInput={(event) => {
              event.currentTarget.style.height = "auto";
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 160)}px`;
            }}
            aria-label={t("message")}
            aria-describedby="composer-hint"
            role="combobox"
            aria-haspopup="listbox"
            aria-autocomplete="list"
            aria-expanded={Boolean(query || addMenuOpen)}
            aria-controls={
              query || addMenuOpen ? "composer-capability-menu" : undefined
            }
            aria-activedescendant={
              (query || addMenuOpen) && itemCount > 0
                ? `composer-capability-${Math.min(activeIndex, itemCount - 1)}`
                : undefined
            }
          />
          <ComposerToolbar model={model} />
        </div>
        <div className="composer-footer-status">
          <p
            id="composer-hint"
            className={`composer-hint ${voiceError || attachmentError || state.submissionError ? "error" : ""}`}
            data-mobile-instruction={
              voiceStatus === "idle" &&
              !voiceError &&
              !attachmentError &&
              !state.submissionError &&
              !submitting &&
              !preparing &&
              attachments.length === 0
                ? "true"
                : undefined
            }
            aria-live="polite"
          >
            {attachmentHint(
              voiceStatus,
              voiceError,
              attachmentError,
              state.submissionError,
              attachments,
              preparing,
              state.isRunning,
              submitting,
              t,
            )}
          </p>
          <ComposerProductivityStatus
            hasHistory={state.messages.some(
              (message) => message.role === "user" && message.text.trim(),
            )}
            draftStatus={draftStatus}
          />
        </div>
      </footer>
      {dragging && (
        <div className="attachment-drop-overlay" aria-hidden="true">
          <div>
            <Paperclip size={20} />
            <span>{t("dropFiles")}</span>
          </div>
        </div>
      )}
    </>
  );
}

function ComposerToolbar({ model }: { model: AppViewModel }) {
  const { t } = useI18n();
  const {
    app: { voiceInput, executionPolicy, projects },
    navigation: { runtimeSettings, switchingProject },
    sessionApi: { setThreadModel, interrupt },
    state,
    taskSession: {
      newTaskDraft,
      developmentMode,
      setDevelopmentMode,
      draftAccessMode,
      setDraftAccessMode,
      setDraftModel,
    },
    taskRuntime: { updateAccessMode: updateConversationAccessMode },
    composer: { input, submitting, setComposerMode },
    composerRuntime: { submit },
    attachments: { attachments, preparing },
    capabilities: {
      selected,
      setSelected,
      setQuery,
      addMenuOpen,
      setAddMenuOpen,
      toggleAddMenu,
    },
    voice: {
      status: voiceStatus,
      start: startVoiceInput,
      stop: stopVoiceInput,
    },
    currentProject,
    currentConversation,
    providerReady,
    selectedAccessMode,
    selectedProvider,
    selectedModel,
  } = model;
  const currentDevelopmentMode: TaskDevelopmentMode = newTaskDraft
    ? developmentMode
    : currentConversation?.workspace?.mode === "worktree"
      ? "worktree"
      : "local";
  const showDevelopmentMode = Boolean(
    projects && projectSupportsDevelopmentMode(currentProject),
  );
  const developmentModeEditable = Boolean(
    showDevelopmentMode && newTaskDraft && !state.threadId,
  );

  return (
    <div className="composer-toolbar">
      <div className="composer-toolbar-start">
        <button
          type="button"
          className={`composer-action add pressable ${addMenuOpen ? "active" : ""}`}
          onPointerDown={(event) =>
            activateComposerMenuOnPointerDown(event, toggleAddMenu)
          }
          onClick={(event) => {
            if (event.detail === 0) toggleAddMenu();
          }}
          disabled={
            state.connection !== "ready" ||
            !providerReady ||
            submitting ||
            preparing
          }
          aria-label={t("add")}
          aria-expanded={addMenuOpen}
          aria-controls={addMenuOpen ? "composer-capability-menu" : undefined}
          title={t("add")}
        >
          <Plus size={18} />
        </button>
        {showDevelopmentMode && (
          <DevelopmentModeControl
            mode={currentDevelopmentMode}
            disabled={
              !developmentModeEditable ||
              submitting ||
              preparing ||
              voiceStatus !== "idle"
            }
            onOpen={() => {
              setAddMenuOpen(false);
              setQuery(undefined);
            }}
            onChange={setDevelopmentMode}
          />
        )}
        {executionPolicy &&
          projects &&
          currentProject &&
          (state.threadId || newTaskDraft) && (
            <ConversationAccessControl
              mode={selectedAccessMode}
              disabled={
                state.connection !== "ready" ||
                state.isRunning ||
                switchingProject ||
                voiceStatus !== "idle"
              }
              onOpen={() => {
                setAddMenuOpen(false);
                setQuery(undefined);
              }}
              onChange={
                newTaskDraft
                  ? (mode) => setDraftAccessMode(mode)
                  : updateConversationAccessMode
              }
            />
          )}
      </div>
      <div className="composer-toolbar-end">
        <ModelSelector
          settings={runtimeSettings}
          provider={selectedProvider}
          model={selectedModel}
          disabled={
            state.connection !== "ready" ||
            !providerReady ||
            state.isRunning ||
            voiceStatus !== "idle" ||
            submitting ||
            preparing
          }
          t={t}
          onSelect={(selection) => {
            if (newTaskDraft) setDraftModel(selection);
            else if (state.threadId) {
              setThreadModel(
                state.threadId,
                selection.provider,
                selection.model,
              );
            }
          }}
        />
        {voiceInput && !state.isRunning && (
          <VoiceInputButton
            status={voiceStatus}
            onToggle={() => {
              if (voiceStatus === "recording") stopVoiceInput();
              else void startVoiceInput();
            }}
            disabled={state.connection !== "ready" || !providerReady}
            t={t}
          />
        )}
        {state.isRunning && (
          <button
            type="button"
            className="composer-action send pressable"
            onPointerDown={preserveComposerFocusOnPointerDown}
            onClick={() => void submit(input, "queued")}
            disabled={
              submitting ||
              preparing ||
              (!input.trim() && attachments.length === 0)
            }
            aria-label={t("queueMessage")}
            title={t("queueMessage")}
          >
            {submitting ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ArrowUp size={18} strokeWidth={2.4} />
            )}
          </button>
        )}
        {state.isRunning ? (
          <button
            type="button"
            className="composer-action stop pressable"
            onPointerDown={preserveComposerFocusOnPointerDown}
            onClick={() => void interrupt()}
            aria-label={t("stopRun")}
            title={t("stop")}
          >
            <CircleStop size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="composer-action send pressable"
            onPointerDown={preserveComposerFocusOnPointerDown}
            onClick={() => void submit()}
            disabled={
              submitting ||
              !composerSubmissionAvailable(
                input,
                attachments.length,
                selected,
              ) ||
              state.connection !== "ready" ||
              !providerReady ||
              voiceStatus !== "idle" ||
              preparing
            }
            aria-label={t("sendMessage")}
            title={t("send")}
          >
            {submitting ? (
              <LoaderCircle className="spin" size={18} />
            ) : (
              <ArrowUp size={18} strokeWidth={2.4} />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
