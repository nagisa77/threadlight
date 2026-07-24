import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "scripted-mcp", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions: "Use double to multiply a number by two.",
  },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "double",
      description: "Multiply a number by two.",
      inputSchema: {
        type: "object",
        properties: { value: { type: "number" } },
        required: ["value"],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "double") {
    return {
      isError: true,
      content: [{ type: "text", text: "Unknown scripted tool" }],
    };
  }
  const value = request.params.arguments?.value;
  if (typeof value !== "number") {
    return {
      isError: true,
      content: [{ type: "text", text: "value must be a number" }],
    };
  }
  return {
    content: [{ type: "text", text: String(value * 2) }],
    structuredContent: { value: value * 2 },
  };
});

await server.connect(new StdioServerTransport());
