import { memo, useRef } from "react";
import type {
  AgentTreeData,
  CapabilityDescriptor,
  ConversationActivityData,
} from "@threadlight/protocol";
import { LoaderCircle } from "lucide-react";

import type { AppViewModel } from "./app-view-model.js";
import { useI18n } from "./i18n.js";
import { isNearBottom } from "./scroll.js";
import { MarkdownContent, type LocalFileReference } from "./markdown.js";
import { MessageCapabilityReceipts } from "./capabilities.js";
import { TaskHeader } from "./features/productivity/task-header.js";
import { EmptyState } from "./features/navigation/project-dialogs.js";
import { ConversationTimeline as Timeline } from "./features/task-session/conversation-timeline.js";
import {
  ActivityList,
  AgentTreePanel,
  ConnectionError,
  MissingThreadRecovery,
  MessageAttachments,
  ProgressList,
  shortId,
} from "./features/task-session/conversation-content.js";
import { GuidedMessageReceipt } from "./features/composer/composer-queue.js";
import { MessageActions } from "./features/task-session/turn-status.js";
import {
  DeliveryTurnStatus,
  shouldShowDeliveryTurnStatus,
} from "./features/delivery/delivery-turn-status.js";
import type { AttachmentPreviewAdapter } from "./features/shared/adapters.js";
import type { ConversationMessage } from "./features/task-session/session.js";

export function ConversationSurface({ model }: { model: AppViewModel }) {
  const { t } = useI18n();
  const {
    app: {
      client,
      taskLinksEnabled,
      clipboard,
      settings,
      attachmentPreview,
      workspace,
    },
    navigation: { setView },
    sessionApi: { retry, terminateProcess },
    state,
    taskSession: {
      conversationRecoveryBusy,
      conversationRecoveryError,
      conversation,
      followOutput,
    },
    capabilities: { capabilities },
    delivery: {
      conversationChanges,
      automaticDelivery,
      hasConversationChanges,
      retryAutomaticDelivery,
      undoAutomaticDelivery,
      openDeliveryCenter,
      openLocalFile,
      revealLocalFile,
      workspaceAgentPanel,
    },
    taskRuntime: {
      suggestions,
      suggestionsLoading,
      suggestionsFailed,
      retrySuggestions,
      showJumpToLatest,
      setShowJumpToLatest,
      jumpToMessage,
      repairMissingThread,
      relinkMissingThread,
    },
    productivity,
    currentProject,
    currentConversation,
    headerTitle,
    requestMissingThreadMetadataDelete,
    composer: { setInput, textarea },
    composerRuntime: { rewriteQuestion },
    navigationRuntime: {
      createProjectThread,
      createStandaloneThread,
      openProjectFolder,
    },
  } = model;
  const isEmpty = state.messages.length === 0 && state.connection !== "error";
  const messageHandlers = useRef({
    client,
    threadId: state.threadId,
    terminateProcess,
    openLocalFile,
    revealLocalFile,
    rewriteQuestion,
    jumpToMessage,
    openAgentPanel: workspaceAgentPanel.open,
    toggleBookmark: productivity.toggleBookmark,
    copyText: clipboard?.writeText,
  });
  messageHandlers.current = {
    client,
    threadId: state.threadId,
    terminateProcess,
    openLocalFile,
    revealLocalFile,
    rewriteQuestion,
    jumpToMessage,
    openAgentPanel: workspaceAgentPanel.open,
    toggleBookmark: productivity.toggleBookmark,
    copyText: clipboard?.writeText,
  };
  const stableMessageHandlers = useRef({
    onTerminateProcess: (sessionId: string) =>
      messageHandlers.current.terminateProcess(sessionId),
    onOpenLocalFile: (reference: LocalFileReference) =>
      messageHandlers.current.openLocalFile(reference),
    onRevealLocalFile: (reference: LocalFileReference) =>
      messageHandlers.current.revealLocalFile(reference),
    onRewriteQuestion: (text: string) =>
      messageHandlers.current.rewriteQuestion(text),
    onJumpToMessage: (messageId: string) =>
      messageHandlers.current.jumpToMessage(messageId),
    onOpenAgent: (tree: AgentTreeData, agentThreadId: string) =>
      messageHandlers.current.openAgentPanel(tree, agentThreadId),
    onToggleBookmark: (messageId: string) =>
      messageHandlers.current.toggleBookmark(messageId),
    onCopyText: (text: string) =>
      messageHandlers.current.copyText?.(text) ?? Promise.resolve(),
    onReadActivity: async (activityId: string) => {
      const { threadId, client: currentClient } = messageHandlers.current;
      if (!threadId) throw new Error("Cannot read activity without a thread");
      const { activity } = await currentClient.readActivity(
        threadId,
        activityId,
      );
      return activity;
    },
  }).current;

  return (
    <>
      <TaskHeader
        title={headerTitle}
        context={
          currentProject?.scope === "standalone"
            ? t("notInProject")
            : currentProject?.runtime?.kind === "remote"
              ? `${t("remoteRuntime")} · ${currentProject.runtime.workspacePath}`
              : (currentProject?.basePath ?? t("agentRuntime"))
        }
        taskId={shortId(state.threadId)}
        running={state.isRunning}
        runMetrics={state.runMetrics}
        connectionReady={
          state.connection === "ready" && Boolean(state.threadId)
        }
        bookmarkCount={productivity.bookmarkedMessages.length}
        taskLinksEnabled={taskLinksEnabled}
        onCopyReference={productivity.copyReference}
        onExport={productivity.exportConversation}
        onOpenBookmarks={() => productivity.setBookmarksOpen(true)}
      />

      <section
        ref={conversation}
        className={`conversation ${isEmpty ? "is-empty" : ""} ${hasConversationChanges ? "has-conversation-changes" : ""} ${showJumpToLatest || state.plan || hasConversationChanges ? "has-composer-floats" : ""}`}
        aria-live="polite"
        onScroll={(event) => {
          const following = isNearBottom(event.currentTarget);
          followOutput.current = following;
          setShowJumpToLatest(!following);
        }}
      >
        <Timeline
          messages={state.messages}
          onJump={stableMessageHandlers.onJumpToMessage}
        />
        <div className="conversation-inner">
          {state.recovery?.kind === "missing_thread" ? (
            <MissingThreadRecovery
              threadId={state.recovery.threadId}
              busy={conversationRecoveryBusy}
              error={conversationRecoveryError}
              onRepair={() => void repairMissingThread()}
              onRelink={(threadId) => void relinkMissingThread(threadId)}
              onDeleteMetadata={requestMissingThreadMetadataDelete}
            />
          ) : state.connection === "error" ? (
            <ConnectionError
              message={state.connectionError ?? t("appServerConnectionFailed")}
              onRetry={() => void retry()}
              onOpenSettings={settings ? () => setView("settings") : undefined}
            />
          ) : null}

          {isEmpty ? (
            <EmptyConversation model={model} />
          ) : (
            <div className="message-list">
              {state.messages.map((message) => (
                <ConversationMessageItem
                  key={message.id}
                  message={message}
                  capabilities={capabilities}
                  attachmentPreview={attachmentPreview}
                  bookmarked={productivity.bookmarkedIds.includes(message.id)}
                  canCopyText={Boolean(clipboard?.writeText)}
                  canRevealLocalFile={Boolean(
                    workspace?.reveal || workspace?.revealSystemFile,
                  )}
                  onTerminateProcess={stableMessageHandlers.onTerminateProcess}
                  onReadActivity={
                    state.threadId
                      ? stableMessageHandlers.onReadActivity
                      : undefined
                  }
                  onOpenLocalFile={stableMessageHandlers.onOpenLocalFile}
                  onRevealLocalFile={stableMessageHandlers.onRevealLocalFile}
                  onRewriteQuestion={stableMessageHandlers.onRewriteQuestion}
                  onOpenAgent={stableMessageHandlers.onOpenAgent}
                  onToggleBookmark={stableMessageHandlers.onToggleBookmark}
                  onCopyText={stableMessageHandlers.onCopyText}
                />
              ))}

              <LiveRun
                model={model}
                onReadActivity={
                  state.threadId
                    ? stableMessageHandlers.onReadActivity
                    : undefined
                }
              />
              {shouldShowDeliveryTurnStatus(
                currentConversation?.workspace?.mode,
                state.isRunning,
              ) && (
                <DeliveryTurnStatus
                  delivery={automaticDelivery}
                  disabled={
                    automaticDelivery?.status === "syncing" ||
                    automaticDelivery?.status === "undoing"
                  }
                  onOpen={openDeliveryCenter}
                  onRetry={
                    workspace?.applyDelivery
                      ? () => void retryAutomaticDelivery()
                      : undefined
                  }
                  onUndo={
                    workspace?.undoDelivery
                      ? () => void undoAutomaticDelivery()
                      : undefined
                  }
                />
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}

interface ConversationMessageItemProps {
  message: ConversationMessage;
  capabilities: readonly CapabilityDescriptor[];
  attachmentPreview?: AttachmentPreviewAdapter;
  bookmarked: boolean;
  canCopyText: boolean;
  canRevealLocalFile: boolean;
  onTerminateProcess(sessionId: string): Promise<unknown>;
  onReadActivity?(activityId: string): Promise<ConversationActivityData>;
  onOpenLocalFile(reference: LocalFileReference): void;
  onRevealLocalFile(reference: LocalFileReference): void | Promise<void>;
  onRewriteQuestion(text: string): void;
  onOpenAgent(tree: AgentTreeData, agentThreadId: string): void;
  onToggleBookmark(messageId: string): void;
  onCopyText(text: string): Promise<void>;
}

export const ConversationMessageItem = memo(function ConversationMessageItem({
  message,
  capabilities,
  attachmentPreview,
  bookmarked,
  canCopyText,
  canRevealLocalFile,
  onTerminateProcess,
  onReadActivity,
  onOpenLocalFile,
  onRevealLocalFile,
  onRewriteQuestion,
  onOpenAgent,
  onToggleBookmark,
  onCopyText,
}: ConversationMessageItemProps) {
  return (
    <article
      id={`message-${message.id}`}
      className={`message ${message.role} ${message.error ? "error" : ""}`}
      tabIndex={-1}
    >
      {message.role === "user" && message.followUpDelivery === "inject" && (
        <GuidedMessageReceipt />
      )}
      {message.role === "user" &&
        message.attachments &&
        message.attachments.length > 0 && (
          <MessageAttachments
            attachments={message.attachments}
            attachmentPreview={attachmentPreview}
          />
        )}
      <MessageCapabilityReceipts
        role={message.role}
        capabilities={message.capabilities}
        capabilityRefs={message.capabilityRefs}
        catalog={capabilities}
      />
      {(message.text || message.role === "assistant") && (
        <div className="message-body">
          {message.progress && message.progress.length > 0 && (
            <ProgressList
              progress={message.progress}
              onTerminateProcess={onTerminateProcess}
              onReadActivity={onReadActivity}
              onOpenLocalFile={onOpenLocalFile}
              onRevealLocalFile={
                canRevealLocalFile ? onRevealLocalFile : undefined
              }
            />
          )}
          {(!message.progress || message.progress.length === 0) &&
            message.activities &&
            message.activities.length > 0 && (
              <ActivityList
                activities={message.activities}
                onTerminateProcess={onTerminateProcess}
                onReadActivity={onReadActivity}
              />
            )}
          {message.role === "assistant" && (
            <AgentTreePanel
              tree={message.agentTree}
              onOpenInPanel={onOpenAgent}
            />
          )}
          {message.role === "assistant" ? (
            <MarkdownContent
              onOpenLocalFile={onOpenLocalFile}
              sources={message.sources}
              citations={message.citations}
              onRevealLocalFile={
                canRevealLocalFile ? onRevealLocalFile : undefined
              }
            >
              {message.text}
            </MarkdownContent>
          ) : (
            <p>{message.text}</p>
          )}
        </div>
      )}
      {message.text && (
        <MessageActions
          role={message.role}
          text={message.text}
          copyText={canCopyText ? onCopyText : undefined}
          onRewrite={
            message.role === "user"
              ? () => onRewriteQuestion(message.text)
              : undefined
          }
          bookmarked={bookmarked}
          onToggleBookmark={() => onToggleBookmark(message.id)}
        />
      )}
    </article>
  );
});

function EmptyConversation({ model }: { model: AppViewModel }) {
  const {
    state,
    currentProject,
    navigation: { projectSnapshot },
    navigationRuntime: {
      createProjectThread,
      createStandaloneThread,
      openProjectFolder,
    },
    taskRuntime: {
      suggestions,
      suggestionsLoading,
      suggestionsFailed,
      retrySuggestions,
    },
    composer: { setInput, textarea },
  } = model;
  return (
    <EmptyState
      connecting={state.connection === "connecting"}
      project={currentProject}
      projects={(projectSnapshot?.projects ?? []).filter(
        (project) => project.scope !== "standalone",
      )}
      suggestions={suggestions}
      suggestionsLoading={suggestionsLoading}
      suggestionsFailed={suggestionsFailed}
      onRetrySuggestions={retrySuggestions}
      onSelectProject={createProjectThread}
      onOpenProject={() => void openProjectFolder()}
      onCreateStandalone={() => void createStandaloneThread()}
      onSelect={(value) => {
        setInput(value);
        textarea.current?.focus();
      }}
    />
  );
}

function LiveRun({
  model,
  onReadActivity,
}: {
  model: AppViewModel;
  onReadActivity?(activityId: string): Promise<ConversationActivityData>;
}) {
  const { t } = useI18n();
  const {
    app: { workspace },
    state,
    sessionApi: { terminateProcess },
    delivery: { openLocalFile, revealLocalFile },
  } = model;
  if (
    state.progress.length === 0 &&
    state.streamingText.length === 0 &&
    !state.isThinking
  ) {
    return null;
  }
  return (
    <div className="live-run">
      {state.progress.length > 0 && (
        <ProgressList
          progress={state.progress}
          live
          onTerminateProcess={terminateProcess}
          onReadActivity={onReadActivity}
          onOpenLocalFile={openLocalFile}
          onRevealLocalFile={
            workspace?.reveal || workspace?.revealSystemFile
              ? revealLocalFile
              : undefined
          }
        />
      )}
      {state.streamingText.length > 0 && (
        <div className="streaming-copy" aria-busy="true">
          <MarkdownContent
            onOpenLocalFile={openLocalFile}
            onRevealLocalFile={
              workspace?.reveal || workspace?.revealSystemFile
                ? revealLocalFile
                : undefined
            }
            sources={state.streamingSources}
            citations={state.streamingCitations}
          >
            {state.streamingText}
          </MarkdownContent>
        </div>
      )}
      {state.isThinking && (
        <div className="thinking-row">
          <LoaderCircle size={15} />
          {t("thinking")}
        </div>
      )}
    </div>
  );
}
