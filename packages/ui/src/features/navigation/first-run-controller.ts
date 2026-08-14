import { useEffect } from "react";
import type { ThreadlightClient } from "@threadlight/client";
import type {
  AttachmentData,
  CapabilityDescriptor,
  ConversationAccessMode,
  TaskDevelopmentMode,
  TurnMode,
} from "@threadlight/protocol";

import {
  prepareFirstRunDemoProject,
  type ProjectSummary,
  type ProjectsAdapter,
  type ProjectsSnapshot,
} from "../../projects.js";
import type { Translate } from "../../i18n.js";
import { completeFirstRun } from "./controller.js";

type NewThreadResult =
  { error: string } | { threadId: string; sent: boolean } | undefined;

export function useFirstRunController({
  client,
  projects,
  project,
  projectSnapshot,
  providerReady,
  demoThreadId,
  setCompleted,
  setDemoThreadId,
  setRetryDemo,
  setProjectSnapshot,
  setNewTaskDraft,
  setNewTaskDraftError,
  showThread,
  sendNewThread,
  t,
}: {
  client: ThreadlightClient;
  projects?: ProjectsAdapter;
  project?: ProjectSummary;
  projectSnapshot?: ProjectsSnapshot;
  providerReady: boolean;
  demoThreadId?: string;
  setCompleted(value: boolean): void;
  setDemoThreadId(value: string | undefined): void;
  setRetryDemo(value: boolean): void;
  setProjectSnapshot(snapshot: ProjectsSnapshot): void;
  setNewTaskDraft(value: boolean): void;
  setNewTaskDraftError(error: string | undefined): void;
  showThread(): void;
  sendNewThread(
    value: string,
    attachments: readonly AttachmentData[],
    mode: TurnMode,
    capabilities: readonly CapabilityDescriptor[],
    accessMode: ConversationAccessMode,
    provider: string | undefined,
    model: string | undefined,
    developmentMode: TaskDevelopmentMode,
  ): Promise<NewThreadResult>;
  t: Translate;
}) {
  useEffect(() => {
    if (!demoThreadId) return;
    const completed = client.on("turn/completed", ({ threadId }) => {
      if (threadId !== demoThreadId) return;
      completeFirstRun(setCompleted);
      setDemoThreadId(undefined);
      setRetryDemo(false);
    });
    const failed = client.on("turn/failed", ({ threadId }) => {
      if (threadId !== demoThreadId) return;
      setDemoThreadId(undefined);
      setRetryDemo(true);
    });
    return () => {
      completed();
      failed();
    };
  }, [client, demoThreadId, setCompleted, setDemoThreadId, setRetryDemo]);

  useEffect(() => {
    if (!demoThreadId || !projectSnapshot) return;
    const demo = projectSnapshot.projects
      .flatMap((candidate) => candidate.conversations)
      .find(({ id }) => id === demoThreadId);
    if (demo?.status !== "completed") return;
    completeFirstRun(setCompleted);
    setDemoThreadId(undefined);
    setRetryDemo(false);
  }, [
    demoThreadId,
    projectSnapshot,
    setCompleted,
    setDemoThreadId,
    setRetryDemo,
  ]);

  async function runDemo(accessMode: ConversationAccessMode) {
    if (!projects || !providerReady) throw new Error(t("waitingForRuntime"));
    const demo = await prepareFirstRunDemoProject(projects, project);
    if (!demo) throw new Error(t("waitingForRuntime"));
    if (demo.snapshot) setProjectSnapshot(demo.snapshot);
    const result = await sendNewThread(
      t("firstRunDemoPrompt"),
      [],
      "default",
      [],
      accessMode,
      undefined,
      undefined,
      "local",
    );
    if (!result || ("sent" in result && !result.sent)) {
      throw new Error(t("demoTaskStartFailed"));
    }
    if ("error" in result) throw new Error(result.error);
    setRetryDemo(false);
    setDemoThreadId(result.threadId);
    setNewTaskDraft(false);
    setNewTaskDraftError(undefined);
    showThread();
    setProjectSnapshot(
      await projects.upsertConversation({
        projectId: demo.project.id,
        id: result.threadId,
        title: t("demoTask"),
      }),
    );
  }

  return { runDemo };
}
