#!/usr/bin/env node

import {
  AgentLoop,
  OpenAIResponsesProvider,
} from "@threadlight/agent-loop";
import {
  createExecCommandTool,
  createProjectMemoryTool,
  createWebSearchTool,
} from "@threadlight/builtin-tools";
import { ProjectMemoryStore } from "@threadlight/project-memory";
import { resolve } from "node:path";

import { AppServer } from "./app-server.js";
import { FileConversationStore } from "./conversation-store.js";
import { jsonLineSender, serveJsonLines } from "./stdio.js";
import { createWorkspaceAgentFactory } from "./workspace-agent.js";

if (!process.env.OPENAI_API_KEY) {
  process.stderr.write("OPENAI_API_KEY is required\n");
  process.exit(1);
}

const provider = new OpenAIResponsesProvider({
  defaultModel: process.env.THREADLIGHT_MODEL ?? "gpt-5.6-sol",
});

const loop = new AgentLoop(provider);
const workspaceRoot = process.cwd();
const projectMemory = new ProjectMemoryStore(workspaceRoot);
await projectMemory.ensure();
const tools = [
  createProjectMemoryTool({ store: projectMemory }),
  createExecCommandTool({
    workspaceRoot,
  }),
];

if (process.env.BRAVE_SEARCH_API_KEY) {
  tools.push(
    createWebSearchTool({
      apiKey: process.env.BRAVE_SEARCH_API_KEY,
    }),
  );
} else {
  process.stderr.write(
    "BRAVE_SEARCH_API_KEY is not set; web_search is disabled\n",
  );
}

const agentFactory = createWorkspaceAgentFactory({
  workspaceRoot,
  baseInstructions:
    "Answer directly. Follow the supplied workspace instructions and use the project context before answering or acting. Use tools when they provide evidence needed for the task. Project memory is durable context, not an enforcement layer. When the user explicitly asks you to remember a project fact, or you discover a stable project-specific fact that will materially help future tasks, update .threadlight/MEMORY.md with project_memory. Read it immediately before writing, revise stale or duplicate entries, keep it concise and specific, and never store secrets, transient task state, chat transcripts, or unverified assumptions.",
  tools,
});

const send = jsonLineSender(process.stdout);
const server = new AppServer({
  loop,
  agentFactory,
  send,
  conversationStore: new FileConversationStore(
    resolve(workspaceRoot, ".threadlight", "conversations"),
  ),
  autoApproveAll: process.env.THREADLIGHT_AUTO_APPROVE === "1",
});

serveJsonLines(server, process.stdin, (error) => {
  process.stderr.write(`Invalid JSON-RPC input: ${String(error)}\n`);
});

process.stderr.write("Threadlight app-server is listening on stdio\n");
