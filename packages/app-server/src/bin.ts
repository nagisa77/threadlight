#!/usr/bin/env node

import {
  AgentLoop,
  OpenAIResponsesProvider,
  defineAgent,
} from "@threadlight/agent-loop";
import {
  createExecCommandTool,
  createWebSearchTool,
} from "@threadlight/builtin-tools";

import { AppServer } from "./app-server.js";
import { jsonLineSender, serveJsonLines } from "./stdio.js";

if (!process.env.OPENAI_API_KEY) {
  process.stderr.write("OPENAI_API_KEY is required\n");
  process.exit(1);
}

const provider = new OpenAIResponsesProvider({
  defaultModel: process.env.THREADLIGHT_MODEL ?? "gpt-5.6-sol",
});

const loop = new AgentLoop(provider);
const tools = [
  createExecCommandTool({
    workspaceRoot: process.cwd(),
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

const agent = defineAgent({
  name: "threadlight",
  instructions:
    "Answer directly. Use tools when they provide evidence needed for the task.",
  tools,
});

const send = jsonLineSender(process.stdout);
const server = new AppServer({ loop, agent, send });

serveJsonLines(server, process.stdin, (error) => {
  process.stderr.write(`Invalid JSON-RPC input: ${String(error)}\n`);
});

process.stderr.write("Threadlight app-server is listening on stdio\n");
