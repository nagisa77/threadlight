import type {
  AgentFactory,
  ThreadRuntimeFactory,
  ThreadState,
} from "./app-server.js";
import type {
  ConversationStore,
  StoredConversation,
} from "./conversation-store.js";
import { composePrompt } from "./prompt-composer.js";
import {
  attachRuntimeTools,
  interruptActiveAgentRuns,
  promptBlocksForAgent,
  restoreStoredPrompt,
} from "./app-server-support.js";

export interface AppServerThreadFactoryHost {
  agentFactory: AgentFactory;
  threadRuntimeFactory?: ThreadRuntimeFactory;
  conversationStore: ConversationStore;
  now(): Date;
}

export class AppServerThreadFactory {
  constructor(private readonly host: AppServerThreadFactoryHost) {}

  async createThreadState(
    storedConversation: StoredConversation,
    runtimeError?: string,
  ): Promise<ThreadState> {
    const conversation = interruptActiveAgentRuns(
      storedConversation,
      this.host.now().toISOString(),
      runtimeError,
    );
    if (conversation !== storedConversation) {
      await this.host.conversationStore.save(conversation);
    }
    const baseAgent = await this.host.agentFactory();
    const runtime = await this.host.threadRuntimeFactory?.(
      conversation.agentSnapshot?.runtime,
    );
    try {
      const promptSnapshot = conversation.agentSnapshot
        ? restoreStoredPrompt(conversation.agentSnapshot.prompt)
        : composePrompt([
            ...promptBlocksForAgent(baseAgent),
            ...(runtime?.promptBlocks ?? []),
          ]);
      const agent = runtime
        ? attachRuntimeTools(
            {
              ...baseAgent,
              instructions: promptSnapshot.instructions,
              ...(conversation.provider
                ? { provider: conversation.provider }
                : {}),
              ...(conversation.model ? { model: conversation.model } : {}),
            },
            runtime,
          )
        : {
            ...baseAgent,
            instructions: promptSnapshot.instructions,
            ...(conversation.provider
              ? { provider: conversation.provider }
              : {}),
            ...(conversation.model ? { model: conversation.model } : {}),
          };
      const snapshottedConversation = conversation.agentSnapshot
        ? conversation
        : {
            ...conversation,
            agentSnapshot: {
              version: 1 as const,
              prompt: promptSnapshot,
              ...(runtime?.snapshot === undefined
                ? {}
                : { runtime: runtime.snapshot }),
            },
          };
      return {
        agent,
        accessMode: conversation.accessMode ?? "approval",
        promptSnapshot,
        conversation: snapshottedConversation,
        conversationMutation: Promise.resolve(),
        revision: 0,
        progress: [],
        ...(runtime ? { runtime } : {}),
      };
    } catch (error) {
      await runtime?.dispose?.();
      throw error;
    }
  }

  async disposeThreadRuntime(thread: ThreadState): Promise<void> {
    thread.titleRequest?.controller.abort(
      new Error("Thread runtime is shutting down"),
    );
    const runtime = thread.runtime;
    thread.runtime = undefined;
    if (!runtime?.dispose) return;
    try {
      await runtime.dispose();
    } catch (error) {
      process.stderr.write(
        `Could not dispose thread runtime ${thread.conversation.threadId}: ${String(error)}\n`,
      );
    }
  }
}
