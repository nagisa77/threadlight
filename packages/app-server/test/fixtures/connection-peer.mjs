import { Socket } from "node:net";

const fd = Number(process.env.THREADLIGHT_CONNECTION_RPC_FD);
const socket = new Socket({ fd, readable: true, writable: true });
let buffer = "";

socket.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  const newline = buffer.indexOf("\n");
  if (newline < 0) return;
  const response = JSON.parse(buffer.slice(0, newline));
  process.stdout.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      method: "fixture/connection-result",
      params: {
        response,
        callbackPrefix:
          process.env.THREADLIGHT_OAUTH_CALLBACK_URL_PREFIX,
      },
    })}\n`,
  );
  socket.end();
});

socket.write(
  `${JSON.stringify({
    jsonrpc: "2.0",
    id: 7,
    method: "connection/status",
    params: {
      connectorId: "gmail",
      version: "1.0.0",
    },
  })}\n`,
);
