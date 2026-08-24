import { RpcResponseError, type ThreadlightClient } from "@threadlight/client";
import type {
  ActiveTurnData,
  AttachmentData,
  ConversationAccessMode,
  ConversationMessageData,
  QueuedTurnData,
  TaskDevelopmentMode,
  TurnMode,
} from "@threadlight/protocol";

export interface OpenedThread {
  threadId: string;
  messages?: readonly ConversationMessageData[];
  queuedTurns?: readonly QueuedTurnData[];
  revision?: number;
  activeTurn?: ActiveTurnData;
  continuationAvailable?: boolean;
  provider?: string;
  model?: string;
}

export type ThreadOpenResult =
  | { status: "opened"; thread: OpenedThread }
  | { status: "missing"; threadId: string };

export async function requestThreadOpen(
  client: Pick<
    ThreadlightClient,
    "initialize" | "resumeThread" | "startThread"
  >,
  threadId?: string,
): Promise<ThreadOpenResult> {
  await client.initialize();
  if (!threadId)
    return { status: "opened", thread: await client.startThread() };
  try {
    return { status: "opened", thread: await client.resumeThread(threadId) };
  } catch (error) {
    if (error instanceof RpcResponseError && error.code === -32001) {
      return { status: "missing", threadId };
    }
    throw error;
  }
}

export async function requestTurnStart(
  client: {
    startTurn(
      threadId: string,
      text: string,
      attachments: readonly AttachmentData[],
      mode: TurnMode,
      capabilityRefs: readonly string[],
      accessMode: ConversationAccessMode,
      provider?: string,
      model?: string,
    ): Promise<unknown>;
  },
  threadId: string,
  text: string,
  attachments: readonly AttachmentData[],
  mode: TurnMode = "default",
  capabilityRefs: readonly string[] = [],
  accessMode: ConversationAccessMode = "approval",
  provider?: string,
  model?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await client.startTurn(
      threadId,
      text,
      attachments,
      mode,
      capabilityRefs,
      accessMode,
      provider,
      model,
    );
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function requestTurnContinuation(
  client: {
    continueTurn(
      threadId: string,
      accessMode: ConversationAccessMode,
      provider?: string,
      model?: string,
    ): Promise<unknown>;
  },
  threadId: string,
  accessMode: ConversationAccessMode = "approval",
  provider?: string,
  model?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await client.continueTurn(threadId, accessMode, provider, model);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function requestNewThreadTurnStart(
  client: {
    initialize(): Promise<unknown>;
    startThread(
      developmentMode?: TaskDevelopmentMode,
    ): Promise<{ threadId: string }>;
    startTurn(
      threadId: string,
      text: string,
      attachments: readonly AttachmentData[],
      mode: TurnMode,
      capabilityRefs: readonly string[],
      accessMode: ConversationAccessMode,
      provider?: string,
      model?: string,
    ): Promise<unknown>;
  },
  text: string,
  attachments: readonly AttachmentData[],
  mode: TurnMode,
  capabilityRefs: readonly string[],
  accessMode: ConversationAccessMode,
  provider: string | undefined,
  model: string | undefined,
  developmentMode: TaskDevelopmentMode,
  onThreadCreated: (threadId: string) => void,
): Promise<{
  threadId: string;
  started: { ok: true } | { ok: false; error: string };
}> {
  await client.initialize();
  const { threadId } = await client.startThread(developmentMode);
  onThreadCreated(threadId);
  return {
    threadId,
    started: await requestTurnStart(
      client,
      threadId,
      text,
      attachments,
      mode,
      capabilityRefs,
      accessMode,
      provider,
      model,
    ),
  };
}
