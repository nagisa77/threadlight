#!/usr/bin/env node

import {
  AgentLoop,
  OpenAIResponsesProvider,
  defineAgent,
  defineTool,
} from "@threadlight/agent-loop";

import { AppServer } from "./app-server.js";
import { jsonLineSender, serveJsonLines } from "./stdio.js";

if (!process.env.OPENAI_API_KEY) {
  process.stderr.write("OPENAI_API_KEY is required\n");
  process.exit(1);
}

const currentTime = defineTool({
  name: "current_time",
  description: "Return the current ISO-8601 timestamp.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  async execute() {
    return new Date().toISOString();
  },
});

const provider = new OpenAIResponsesProvider({
  defaultModel: process.env.THREADLIGHT_MODEL ?? "gpt-5.6-sol",
});

const loop = new AgentLoop(provider);
const agent = defineAgent({
  name: "threadlight",
  instructions:
    "Answer directly. Use tools when they provide evidence needed for the task.",
  tools: [currentTime],
});

const send = jsonLineSender(process.stdout);
const server = new AppServer({ loop, agent, send });

serveJsonLines(server, process.stdin, (error) => {
  process.stderr.write(`Invalid JSON-RPC input: ${String(error)}\n`);
});

process.stderr.write("Threadlight app-server is listening on stdio\n");
