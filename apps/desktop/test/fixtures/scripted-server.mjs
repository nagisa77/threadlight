import { createInterface } from "node:readline";

const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "hang") return;
  process.stdout.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { accepted: true } })}\n`,
  );
});
